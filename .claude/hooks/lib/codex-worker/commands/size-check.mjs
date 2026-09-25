// @ts-check
// run の snapshot と作業場所を読み、行数上限を判定する。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { isInside } from "../../../check-task-scope.mjs";
import { changedSince } from "../core.mjs";
import { emit } from "../output.mjs";
import { languageFor } from "../../code-layout/languages.mjs";

const DEFAULT_MAX_FILE_LINES = 500;
const NO_HEAD = "(no HEAD)";

/**
 * @typedef {object} SnapshotRecord
 * @property {string} root Snapshot root directory.
 * @property {{ head: string }} fingerprint Repository fingerprint.
 * @property {Record<string, { saved?: string | null }>} files Snapshot paths.
 */
/** @typedef {{ allow: string[] }} RunMetadata */
/** @typedef {{ path: string, lines: number, snapshot_lines: number | null }} SizeFinding */
/**
 * @typedef {object} SizeCheckResult
 * @property {boolean} ok True when no violation is present.
 * @property {number} max_file_lines Applied line limit.
 * @property {SizeFinding[]} violations Files that crossed the limit.
 * @property {SizeFinding[]} warnings Previously oversized files that grew.
 */
/** @typedef {{ errors: string[] }} SizeCheckErrors */

/**
 * Convert a caught value to a readable diagnostic.
 * @param {unknown} error Caught value.
 * @returns {string} Error message.
 */
function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Check whether a filesystem error means the path does not exist.
 * @param {unknown} error Caught filesystem error.
 * @returns {boolean} True only for ENOENT.
 */
function isMissingError(error) {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}

/**
 * Convert the content of a regular file to its line count, returning null for NUL-containing data.
 * @param {Buffer} content File bytes.
 * @returns {number | null} Line count, or null when the file is binary.
 */
function countLines(content) {
  if (content.includes(0)) return null;

  const newlines = content.reduce((count, byte) => count + Number(byte === 10), 0);

  return content.length === 0 || content.at(-1) === 10 ? newlines : newlines + 1;
}

/**
 * Read the file's bytes only when its current path is a regular, non-symlink file.
 * @param {string} absolutePath Absolute file path.
 * @returns {{ kind: "missing" | "other" } | { kind: "file", content: Buffer }} Current path state.
 */
function readRegularFile(absolutePath) {
  let stat;
  try {
    stat = fs.lstatSync(absolutePath);
  } catch (error) {
    if (isMissingError(error)) return { kind: "missing" };
    throw error;
  }
  if (!stat.isFile()) return { kind: "other" };

  return { kind: "file", content: fs.readFileSync(absolutePath) };
}

/**
 * Read a path's baseline bytes from the saved copy or the snapshot's HEAD commit.
 * @param {string} runDir Directory containing the run record.
 * @param {SnapshotRecord} snapshot Parsed snapshot record.
 * @param {string} filePath Root-relative changed path.
 * @param {string} repositoryPrefix Repository path prefix for a nested snapshot root.
 * @returns {Buffer | null} Baseline bytes, or null when the path did not exist at snapshot time.
 */
function readSnapshotContent(runDir, snapshot, filePath, repositoryPrefix) {
  const entry = snapshot.files[filePath];
  if (entry?.saved) {
    const saved = path.resolve(runDir, entry.saved);
    const stat = fs.lstatSync(saved);
    if (!stat.isFile()) {
      throw new Error(`snapshot の退避コピーが通常ファイルでない: ${entry.saved}`);
    }

    return fs.readFileSync(saved);
  }
  if (snapshot.fingerprint.head === NO_HEAD) return null;

  const repositoryPath = `${repositoryPrefix}${filePath}`;
  const tree = execFileSync("git", [
    "-C", snapshot.root, "ls-tree", "-r", "--full-tree", "-z",
    snapshot.fingerprint.head,
  ], {
    maxBuffer: 256 * 1024 * 1024,
  }).toString();
  const treeEntry = tree.split("\0").find((item) =>
    item.slice(item.indexOf("\t") + 1) === repositoryPath);
  if (!treeEntry) return null;
  const objectId = treeEntry.slice(0, treeEntry.indexOf("\t")).split(" ")[2];

  return execFileSync("git", ["-C", snapshot.root, "cat-file", "blob", objectId], {
    maxBuffer: 256 * 1024 * 1024,
  });
}

/**
 * Read and validate the two immutable records required by a run.
 * @param {string} runDir Directory containing run.json and snapshot.json.
 * @returns {{ snapshot: SnapshotRecord, metadata: RunMetadata } | SizeCheckErrors}
 * Parsed records or a readable error.
 */
function readRunRecords(runDir) {
  try {
    /** @type {unknown} */
    const snapshotValue = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
    /** @type {unknown} */
    const metadataValue = JSON.parse(fs.readFileSync(path.join(runDir, "run.json"), "utf8"));
    if (typeof snapshotValue !== "object" || snapshotValue === null
      || typeof metadataValue !== "object" || metadataValue === null) {
      throw new Error("run.json または snapshot.json の形式が不正");
    }
    const snapshot = /** @type {Record<string, unknown>} */ (snapshotValue);
    const metadata = /** @type {Record<string, unknown>} */ (metadataValue);
    if (typeof snapshot.root !== "string" || typeof snapshot.fingerprint?.head !== "string"
      || !snapshot.files || typeof snapshot.files !== "object" || Array.isArray(snapshot.files)
      || !Array.isArray(metadata.allow)
      || !metadata.allow.every((entry) => typeof entry === "string")) {
      throw new Error("run.json または snapshot.json の形式が不正");
    }

    return {
      snapshot: /** @type {SnapshotRecord} */ (snapshot),
      metadata: /** @type {RunMetadata} */ (metadata),
    };
  } catch (error) {
    return { errors: [`run の記録を読めない: ${runDir}: ${errorMessage(error)}`] };
  }
}

/**
 * Find line-limit violations and warnings among allowed changed code files.
 * @param {string} runDir Directory containing the saved snapshot copies.
 * @param {SnapshotRecord} snapshot Parsed snapshot record.
 * @param {string[]} allow Root-relative paths from run.json.
 * @param {number} maxFileLines Maximum allowed current line count.
 * @returns {{ violations: SizeFinding[], warnings: SizeFinding[] }} Findings.
 */
function findSizeFindings(runDir, snapshot, allow, maxFileLines) {
  const repositoryPrefix = execFileSync("git", [
    "-C", snapshot.root, "rev-parse", "--show-prefix",
  ], {
    encoding: "utf8",
  }).trim();
  const changed = changedSince(snapshot);
  const files = changed
    .filter((filePath) =>
      allow.some((allowed) => isInside(filePath, allowed, snapshot.root)))
    .filter((filePath) => languageFor(filePath) !== null);
  const violations = [];
  const warnings = [];

  for (const filePath of files) {
    const current = readRegularFile(path.join(snapshot.root, filePath));
    if (current.kind !== "file") continue;

    const lines = countLines(current.content);
    if (lines === null || lines <= maxFileLines) continue;

    const baseline = readSnapshotContent(runDir, snapshot, filePath, repositoryPrefix);
    const snapshotLines = baseline === null ? null : countLines(baseline);
    if (baseline !== null && snapshotLines !== null && snapshotLines <= maxFileLines) {
      violations.push({ path: filePath, lines, snapshot_lines: snapshotLines });
    } else if (baseline !== null && snapshotLines !== null
      && snapshotLines > maxFileLines && lines > snapshotLines) {
      warnings.push({ path: filePath, lines, snapshot_lines: snapshotLines });
    } else if (snapshotLines === null && baseline === null) {
      violations.push({ path: filePath, lines, snapshot_lines: null });
    }
  }

  return { violations, warnings };
}

/**
 * Check changed allowed code files against a line limit.
 * @param {string} runDir Directory containing run.json and snapshot.json.
 * @param {{ maxFileLines?: number }} [options] Positive line limit, defaulting to 500.
 * @returns {SizeCheckResult | SizeCheckErrors} Success findings, or run errors.
 */
export function sizeCheckRun(runDir, { maxFileLines = DEFAULT_MAX_FILE_LINES } = {}) {
  if (!Number.isInteger(maxFileLines) || maxFileLines <= 0) {
    return { errors: ["--max-file-lines は正の整数"] };
  }

  const records = readRunRecords(runDir);
  if ("errors" in records) return records;
  const { snapshot, metadata } = records;

  try {
    if (!fs.statSync(snapshot.root).isDirectory()) {
      return { errors: [`作業場所がもう無い: ${snapshot.root}`] };
    }
  } catch (error) {
    if (isMissingError(error)) return { errors: [`作業場所がもう無い: ${snapshot.root}`] };
    return { errors: [`作業場所を読めない: ${snapshot.root}: ${errorMessage(error)}`] };
  }

  try {
    const { violations, warnings } = findSizeFindings(
      runDir,
      snapshot,
      metadata.allow,
      maxFileLines,
    );
    return {
      ok: violations.length === 0,
      max_file_lines: maxFileLines,
      violations,
      warnings,
    };
  } catch (error) {
    return {
      errors: [`size-check を実行できない: ${snapshot.root}: ${errorMessage(error)}`],
    };
  }
}

/**
 * Run the size-check CLI command and emit its JSON result with the contract exit code.
 * @param {Record<string, string | string[] | boolean | undefined>} args Parsed CLI values.
 * @returns {void} Emits one JSON result and sets the process exit code.
 */
export function sizeCheckCommand(args) {
  const runDir = typeof args.run === "string" ? args.run : "";
  if (runDir.length === 0) {
    emit({ errors: ["--run が必要"] }, null, 2);
    return;
  }
  const limitValue = args["max-file-lines"];
  const maxFileLines = limitValue === undefined ? DEFAULT_MAX_FILE_LINES : Number(limitValue);
  if (!Number.isInteger(maxFileLines) || maxFileLines <= 0) {
    emit({ errors: ["--max-file-lines は正の整数"] }, null, 2);
    return;
  }

  const result = sizeCheckRun(runDir, { maxFileLines });
  const exitCode = "errors" in result ? 2 : (result.ok ? 0 : 1);
  emit(result, null, exitCode);
}
