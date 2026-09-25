// @ts-check

// worktree の置き場・ブランチ名・記録の読み書きと検査、拒否結果の組み立てを持つ。

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { canonical } from "../../../check-task-scope.mjs";
import { hasErrorCode, processErrorText } from "../git.mjs";
import { rootSlug, stateDir, taskDir } from "../worklog.mjs";

const WORKTREE_STATE_DIR = "worktrees";
const WORKTREE_RECORD_FILE = "worktree.json";
const RECOVERY_CLI = "node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree";
const WORKTREE_RECORD_KEYS = ["repo", "path", "branch", "base", "base_ref", "created_at"];
const WORKTREE_RECORD_IO_ERROR_CODES = new Set([
  "EACCES",
  "EIO",
  "EISDIR",
  "EMFILE",
  "ENFILE",
  "ENOTDIR",
  "EPERM",
]);

/**
 * @typedef {object} WorktreeRecord
 * @property {string} repo Main repository's real path.
 * @property {string} path Worktree's real path.
 * @property {string} branch Dedicated local branch name.
 * @property {string} base Main repository commit used at creation.
 * @property {string} base_ref Symbolic HEAD ref used at creation.
 * @property {string} created_at Creation time as ISO 8601.
 */
/**
 * @typedef {object} EnsureWorktreeRefusal
 * @property {false} ok
 * @property {2} code
 * @property {string[]} errors
 */
/** @typedef {{ ok: false, code: 2, errors: string[] }} WorktreeRefusal */
/** Match malformed worktree records and expected failures while reading their file.
 * @param {unknown} error
 * @returns {boolean}
 */
export function isWorktreeRecordReadError(error) {
  if (error instanceof SyntaxError || error instanceof TypeError) return true;
  return typeof error === "object"
    && error !== null
    && "code" in error
    && typeof error.code === "string"
    && WORKTREE_RECORD_IO_ERROR_CODES.has(error.code);
}

/** Turn a known worktree record read failure into a code 2 refusal.
 * @param {unknown} error
 * @returns {WorktreeRefusal | null}
 */
export function worktreeRecordReadRefusal(error) {
  if (!isWorktreeRecordReadError(error)) return null;
  return worktreeRefusal(`worktree の記録を読み取れません: ${processErrorText(error)}`);
}

/** Check that decoded JSON contains exactly the six string fields in a worktree record.
 * @param {unknown} value
 * @returns {value is WorktreeRecord}
 */
export function isWorktreeRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const fields = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(fields).length === WORKTREE_RECORD_KEYS.length
    && WORKTREE_RECORD_KEYS.every((key) => typeof fields[key] === "string");
}

/** Quote one recovery command argument while keeping ordinary paths readable.
 * @param {string} value
 * @returns {string}
 */
export function shellArgument(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build a refusal result with a task-specific recovery command.
 * @param {string} root
 * @param {string} task
 * @param {string} reason
 * @returns {EnsureWorktreeRefusal}
 */
export function refusal(root, task, reason) {
  const command = [
    RECOVERY_CLI,
    "--root",
    shellArgument(root),
    "--task",
    shellArgument(task),
    "--remove --force",
  ].join(" ");
  return { ok: false, code: 2, errors: [`${reason}。復旧: ${command}`] };
}

/** Return a code 2 refusal for a worktree operation.
 * @param {string} error
 * @returns {WorktreeRefusal}
 */
export function worktreeRefusal(error) {
  return { ok: false, code: 2, errors: [error] };
}

/** Return the task's private git branch name, derived from the canonical ledger root.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {string} Dedicated branch name.
 */
export function worktreeBranch(root, task) {
  const rootHash = createHash("sha1").update(canonical(root)).digest("hex").slice(0, 8);
  return `codex-worker/${rootHash}/${task}`;
}

/** Return the configured state directory for a task's worktree.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {string} Worktree directory.
 */
export function worktreeDir(root, task) {
  return path.join(stateDir(), WORKTREE_STATE_DIR, rootSlug(root), task);
}

/** Return the task's worktree record file path.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {string} Record file path.
 */
export function worktreeRecordPath(root, task) {
  return path.join(taskDir(root, task), WORKTREE_RECORD_FILE);
}

/** Read the task's worktree record, returning null when it has not been written.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {WorktreeRecord | null} Parsed record or null when no record exists.
 * @throws {Error} If the record is malformed or the file cannot be read.
 */
export function readWorktreeRecord(root, task) {
  try {
    const parsed = /** @type {unknown} */ (
      JSON.parse(fs.readFileSync(worktreeRecordPath(root, task), "utf8"))
    );
    if (!isWorktreeRecord(parsed)) throw new TypeError("Invalid worktree record");
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}
