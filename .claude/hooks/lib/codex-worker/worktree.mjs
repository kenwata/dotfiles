// @ts-check

// worktree の突き合わせ・作成・状態・破棄・fast-forward 統合の Git 操作を持つ。
// 状態判定と Git の呼び出しをここに閉じ、ロック検査と作業記録の書き込みは呼び出し側に任せる。
// 置き場は ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/worktrees/
// <ルート名>/<T>/、記録は tasks/<ルート名>/<T>/worktree.json に置く。

import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { canonical } from "../../check-task-scope.mjs";
import { rootSlug, stateDir, taskDir } from "./worklog.mjs";

const WORKTREE_STATE_DIR = "worktrees";
const WORKTREE_RECORD_FILE = "worktree.json";
const RECOVERY_CLI = "node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree";
const GIT_MAX_BUFFER = 256 * 1024 * 1024;
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
 * @typedef {object} WorktreeStatus
 * @property {string} path Recorded worktree path.
 * @property {string} branch Recorded branch name.
 * @property {string} base_ref Symbolic HEAD ref used at creation.
 * @property {boolean} exists Whether the registered worktree directory exists.
 * @property {boolean} dirty Whether it has tracked or untracked changes.
 * @property {number | null} ahead Commits on the branch ahead of the main HEAD.
 * @property {number | null} behind Commits on the main HEAD ahead of the branch.
 */
/**
 * @typedef {object} EnsureWorktreeSuccess
 * @property {true} ok
 * @property {boolean} created
 * @property {WorktreeRecord} record
 */
/**
 * @typedef {object} EnsureWorktreeRefusal
 * @property {false} ok
 * @property {2} code
 * @property {string[]} errors
 */
/** @typedef {EnsureWorktreeSuccess | EnsureWorktreeRefusal} EnsureWorktreeResult */
/** @typedef {{ path: string, branch: string | null }} ListedWorktree */
/** @typedef {{ ok: true }} RemoveWorktreeSuccess */
/** @typedef {{ ok: false, code: 2, errors: string[] }} WorktreeRefusal */
/** @typedef {RemoveWorktreeSuccess | WorktreeRefusal} RemoveWorktreeResult */
/**
 * @typedef {object} IntegrationReport
 * @property {string} task Task identifier.
 * @property {string} repo Main repository path.
 * @property {string} branch Integrated task branch.
 * @property {number} commits Number of commits added to main.
 * @property {string} head Main HEAD after integration.
 */
/** @typedef {{ ok: true, report: IntegrationReport }} IntegrateWorktreeSuccess */
/** @typedef {{ ok: false, code: 1 | 2, errors: string[] }} IntegrateWorktreeRefusal */
/** @typedef {IntegrateWorktreeSuccess | IntegrateWorktreeRefusal} IntegrateWorktreeResult */

/** Match a filesystem error by its stable Node.js error code.
 * @param {unknown} error
 * @param {string} code
 * @returns {boolean}
 */
function hasErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Match an execFileSync failure by its process exit status.
 * @param {unknown} error
 * @param {number} status
 * @returns {boolean}
 */
function hasExitStatus(error, status) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && error.status === status;
}

/** Match an execFileSync failure that contains a child-process exit status.
 * @param {unknown} error
 * @returns {boolean}
 */
function hasProcessExitStatus(error) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && typeof error.status === "number";
}

/** Return Git's stderr from a failed command, falling back to the process error message.
 * @param {unknown} error
 * @returns {string}
 */
function processErrorText(error) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/** Match malformed worktree records and expected failures while reading their file.
 * @param {unknown} error
 * @returns {boolean}
 */
function isWorktreeRecordReadError(error) {
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
function worktreeRecordReadRefusal(error) {
  if (!isWorktreeRecordReadError(error)) return null;
  return worktreeRefusal(`worktree の記録を読み取れません: ${processErrorText(error)}`);
}

/** Check that decoded JSON contains exactly the six string fields in a worktree record.
 * @param {unknown} value
 * @returns {value is WorktreeRecord}
 */
function isWorktreeRecord(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;

  const fields = /** @type {Record<string, unknown>} */ (value);
  return Object.keys(fields).length === WORKTREE_RECORD_KEYS.length
    && WORKTREE_RECORD_KEYS.every((key) => typeof fields[key] === "string");
}

/** Run git in a repository and return stdout as text.
 * @param {string} repo
 * @param {string[]} args
 * @returns {string}
 */
function git(repo, args) {
  return execFileSync("git", ["-C", repo, ...args], {
    encoding: "utf8",
    maxBuffer: GIT_MAX_BUFFER,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Return the repository's worktrees with real paths and full local branch names.
 * @param {string} repo
 * @returns {ListedWorktree[]}
 */
function listedWorktrees(repo) {
  const output = git(repo, ["worktree", "list", "--porcelain"]);
  const entries = [];
  let current = null;

  for (const line of output.split("\n")) {
    if (line.startsWith("worktree ")) {
      current = { path: canonical(line.slice("worktree ".length)), branch: null };
      entries.push(current);
    } else if (line.startsWith("branch ") && current !== null) {
      current.branch = line.slice("branch ".length);
    } else if (line === "") {
      current = null;
    }
  }

  return entries;
}

/** Check for a local branch ref without treating remote tracking refs as collisions.
 * @param {string} repo
 * @param {string} branch
 * @returns {boolean}
 */
function localBranchExists(repo, branch) {
  const refs = git(repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`])
    .split("\n")
    .filter(Boolean);
  return refs.includes(`refs/heads/${branch}`);
}

/** Quote one recovery command argument while keeping ordinary paths readable.
 * @param {string} value
 * @returns {string}
 */
function shellArgument(value) {
  if (/^[A-Za-z0-9_./:-]+$/.test(value)) return value;
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Build a refusal result with a task-specific recovery command.
 * @param {string} root
 * @param {string} task
 * @param {string} reason
 * @returns {EnsureWorktreeRefusal}
 */
function refusal(root, task, reason) {
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

/** Return whether a path has any filesystem entry, including a dangling symlink.
 * @param {string} target
 * @returns {boolean}
 */
function pathExists(target) {
  try {
    fs.lstatSync(target);
    return true;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path currently resolves to a directory.
 * @param {string} target
 * @returns {boolean}
 */
function isDirectory(target) {
  try {
    return fs.statSync(target).isDirectory();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path itself is a directory and not a symbolic link.
 * @param {string} target
 * @returns {boolean}
 */
function isRealDirectory(target) {
  try {
    return fs.lstatSync(target).isDirectory();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return whether a path itself is a symbolic link.
 * @param {string} target
 * @returns {boolean}
 */
function isSymbolicLink(target) {
  try {
    return fs.lstatSync(target).isSymbolicLink();
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return false;
    throw error;
  }
}

/** Return a code 2 refusal for a worktree operation.
 * @param {string} error
 * @returns {WorktreeRefusal}
 */
function worktreeRefusal(error) {
  return { ok: false, code: 2, errors: [error] };
}

/** Return the current symbolic branch, or null when HEAD is detached.
 * @param {string} repo
 * @returns {string | null}
 */
function symbolicHead(repo) {
  try {
    return git(repo, ["symbolic-ref", "-q", "HEAD"]).trim();
  } catch (error) {
    if (hasExitStatus(error, 1)) return null;
    throw error;
  }
}

/** Find a safety issue before removing any task worktree state.
 * @param {{ root: string, task: string, repo: string, target: string, branch: string,
 *   record: WorktreeRecord | null, force: boolean }} options
 * @returns {string | null}
 */
function removalProblem({ root, task, repo, target, branch, record, force }) {
  if (isSymbolicLink(target)) {
    return "置き場がシンボリックリンクのため破棄できません";
  }

  const targetCanonical = canonical(target);
  const entries = listedWorktrees(repo);
  const branchRef = `refs/heads/${branch}`;
  const targetEntry = entries.find((entry) => entry.path === targetCanonical);
  const otherCheckout = entries.find(
    (entry) => entry.branch === branchRef && entry.path !== targetCanonical,
  );

  if (otherCheckout !== undefined) {
    return "ブランチが別の場所で checkout されています";
  }
  if (targetEntry !== undefined && targetEntry.branch !== branchRef && !force) {
    return "置き場が別の worktree として登録されています";
  }
  if (record !== null && canonical(record.repo) !== repo) {
    return "記録の本体リポジトリが一致しません";
  }
  if (record !== null && record.branch !== worktreeBranch(root, task)) {
    return "記録のブランチがタスクのブランチと一致しません";
  }
  if (record !== null && canonical(record.path) !== targetCanonical) {
    return "記録の worktree 置き場が一致しません";
  }
  if (force) return null;

  return record === null
    ? unrecordedRemovalProblem(repo, target, branch, targetEntry)
    : recordedRemovalProblem(root, task, target, targetEntry);
}

/** Check whether unrecorded state can safely be removed without force.
 * @param {string} repo
 * @param {string} target
 * @param {string} branch
 * @param {ListedWorktree | undefined} targetEntry
 * @returns {string | null}
 */
function unrecordedRemovalProblem(repo, target, branch, targetEntry) {
  if (targetEntry === undefined && pathExists(target)) {
    return "置き場に登録外のディレクトリがあります";
  }
  if (targetEntry !== undefined && !isDirectory(target)) {
    return "登録済み worktree が存在しません";
  }
  if (targetEntry !== undefined && git(target, ["status", "--porcelain"]) !== "") {
    return "worktree に未コミットの変更があります。--force が必要です";
  }
  if (localBranchExists(repo, branch)) {
    const ahead = Number(git(repo, ["rev-list", "--count", `HEAD..${branch}`]).trim());
    if (ahead > 0) {
      return "ブランチに本体へ未統合のコミットがあります。--force が必要です";
    }
  }
  return null;
}

/** Check recorded status before a non-forced removal.
 * @param {string} root
 * @param {string} task
 * @param {string} target
 * @param {ListedWorktree | undefined} targetEntry
 * @returns {string | null}
 */
function recordedRemovalProblem(root, task, target, targetEntry) {
  if (targetEntry === undefined && pathExists(target)) {
    return "置き場に登録外のディレクトリがあります";
  }
  if (targetEntry !== undefined && !isDirectory(target)) {
    return "登録済み worktree が存在しません";
  }

  const status = worktreeStatus(root, task);
  if (status?.dirty) {
    return "worktree に未コミットの変更があります。--force が必要です";
  }
  if (status?.ahead !== null && status?.ahead !== undefined && status.ahead > 0) {
    return "ブランチに本体へ未統合のコミットがあります。--force が必要です";
  }
  return null;
}

/** Remove the registered or forced orphaned worktree, branch, and record.
 * @param {{ repo: string, target: string, branch: string, recordPath: string,
 *   registered: boolean, force: boolean }} options
 * @returns {void}
 */
function removeWorktreeState({ repo, target, branch, recordPath, registered, force }) {
  if (registered) {
    git(repo, ["worktree", "remove", ...(force ? ["--force"] : []), target]);
  } else if (force && pathExists(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  if (localBranchExists(repo, branch)) {
    git(repo, ["branch", ...(force ? ["-D"] : ["-d"]), branch]);
  }
  if (pathExists(recordPath)) fs.unlinkSync(recordPath);
}

/** Return a code 1 refusal when Git cannot fast-forward the main repository.
 * @param {unknown} error
 * @returns {IntegrateWorktreeRefusal}
 */
function integrationFailure(error) {
  return { ok: false, code: 1, errors: [processErrorText(error)] };
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

/** Reuse a recorded worktree or create the task's first worktree from the main HEAD.
 * Creation writes a private record; inconsistent existing state returns a code 2 refusal.
 * @param {{ root: string, task: string, repo: string, now?: Date }} options
 * @returns {EnsureWorktreeResult} Creation or reuse result, or a code 2 refusal.
 * @throws {Error} If a Git operation or filesystem write fails unexpectedly.
 */
export function ensureWorktree({ root, task, repo, now = new Date() }) {
  const repository = canonical(git(repo, ["rev-parse", "--show-toplevel"]).trim());
  const target = worktreeDir(root, task);
  const targetCanonical = canonical(target);
  const branch = worktreeBranch(root, task);
  const record = readWorktreeRecord(root, task);
  const entries = listedWorktrees(repository);

  if (record !== null) {
    if (canonical(record.repo) !== repository) {
      return refusal(root, task, "記録の本体リポジトリが一致しません");
    }
    if (record.branch !== branch) {
      return refusal(
        root,
        task,
        "記録のブランチがタスクのブランチと一致しません",
      );
    }
    if (canonical(record.path) !== targetCanonical) {
      return refusal(root, task, "記録の worktree 置き場が一致しません");
    }

    const targetEntry = entries.find((entry) => entry.path === targetCanonical);
    if (targetEntry !== undefined && targetEntry.branch !== `refs/heads/${record.branch}`) {
      return refusal(
        root,
        task,
        "置き場の worktree HEAD が記録のブランチと違います",
      );
    }
    if (targetEntry !== undefined && isRealDirectory(target)) {
      return { ok: true, created: false, record };
    }
    return refusal(root, task, "記録がありますが、worktree が存在しません");
  }

  if (entries.some((entry) => entry.path === targetCanonical)) {
    return refusal(root, task, "置き場が別の worktree として登録済みです");
  }

  if (pathExists(target)) {
    return refusal(root, task, "置き場に登録外のディレクトリがあります");
  }

  const fullBranch = `refs/heads/${branch}`;
  if (entries.some((entry) => entry.branch === fullBranch)) {
    return refusal(root, task, "ブランチが別の場所で checkout されています");
  }

  if (localBranchExists(repository, branch)) {
    return refusal(root, task, "記録がなく、ブランチだけ残っています");
  }

  const base = git(repository, ["rev-parse", "HEAD"]).trim();
  let baseRef;
  try {
    baseRef = git(repository, ["symbolic-ref", "-q", "HEAD"]).trim();
  } catch (error) {
    if (!hasExitStatus(error, 1)) throw error;
    const reason = [
      "本体が detached HEAD のため作成できません。",
      "本体でブランチを checkout してから再実行してください",
    ].join("");
    return worktreeRefusal(reason);
  }

  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  git(repository, ["worktree", "add", "-b", branch, target, "HEAD"]);

  const createdRecord = {
    repo: repository,
    path: canonical(target),
    branch,
    base,
    base_ref: baseRef,
    created_at: now.toISOString(),
  };
  const recordPath = worktreeRecordPath(root, task);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(recordPath, `${JSON.stringify(createdRecord, null, 2)}\n`);

  return { ok: true, created: true, record: createdRecord };
}

/** Return the seven status fields for a recorded worktree, or null without a record.
 * This reads the recorded repository's worktree list, working tree, and branch history.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {WorktreeStatus | null} Status or null when no record exists.
 * @throws {Error} If the record or Git state cannot be read.
 */
export function worktreeStatus(root, task) {
  const record = readWorktreeRecord(root, task);
  if (record === null) return null;

  const entries = listedWorktrees(record.repo);
  const recordPath = canonical(record.path);
  const exists = entries.some((entry) => entry.path === recordPath) && isDirectory(record.path);
  const dirty = exists && git(record.path, ["status", "--porcelain"]).trim() !== "";
  const hasBranch = localBranchExists(record.repo, record.branch);
  const ahead = hasBranch
    ? Number(git(record.repo, ["rev-list", "--count", `HEAD..${record.branch}`]).trim())
    : null;
  const behind = hasBranch
    ? Number(git(record.repo, ["rev-list", "--count", `${record.branch}..HEAD`]).trim())
    : null;

  return {
    path: record.path,
    branch: record.branch,
    base_ref: record.base_ref,
    exists,
    dirty,
    ahead,
    behind,
  };
}

/** Return a safety issue when the recorded worktree is not ready for Git integration.
 * @param {{ root: string, task: string, record: WorktreeRecord, repo: string }} options
 * @returns {string | null}
 */
function integrationPreconditionProblem({ root, task, record, repo }) {
  const target = worktreeDir(root, task);
  const expectedPath = canonical(target);
  if (isSymbolicLink(target)) {
    return "置き場がシンボリックリンクのため統合できません";
  }

  if (canonical(record.path) !== expectedPath) {
    return "記録された worktree の置き場が一致しません";
  }
  if (canonical(record.repo) !== repo) return "記録の本体リポジトリが一致しません";
  if (record.branch !== worktreeBranch(root, task)) {
    return "記録のブランチがタスクのブランチと一致しません";
  }

  const entry = listedWorktrees(repo).find((item) => item.path === expectedPath);
  if (entry === undefined) {
    return "記録された worktree が本体の worktree list にありません";
  }
  if (entry.branch !== `refs/heads/${record.branch}`) {
    return "worktree の HEAD が記録のブランチと違います";
  }
  if (!isRealDirectory(record.path)) {
    return "記録された worktree のディレクトリがありません";
  }
  if (git(record.path, ["status", "--porcelain"]) !== "") {
    return `worktree が clean ではありません。監督が自分の変えたファイルをパス指定でコミットしてから統合してください`;
  }

  const currentRef = symbolicHead(repo);
  if (currentRef === null || currentRef !== record.base_ref) {
    return "本体のブランチが記録時の base_ref と一致しません";
  }
  if (!localBranchExists(repo, record.branch)) {
    return "記録されたブランチが本体にありません";
  }
  return null;
}

/** Remove a task worktree and its branch, refusing unsafe state unless force is enabled.
 * Force also cleans orphaned task state, but never removes a branch checked out elsewhere.
 * @param {{ root: string, task: string, repo: string, force?: boolean }} options
 * @returns {RemoveWorktreeResult} Success or a code 2 refusal.
 * @throws {Error} If a Git or filesystem operation fails unexpectedly.
 */
export function removeWorktree({ root, task, repo, force = false }) {
  /** @type {string} */
  let repository;
  try {
    repository = canonical(git(repo, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    if (hasProcessExitStatus(error)) {
      return worktreeRefusal(`本体リポジトリを開けません: ${processErrorText(error)}`);
    }
    throw error;
  }

  /** @type {WorktreeRecord | null} */
  let record;
  try {
    record = readWorktreeRecord(root, task);
  } catch (error) {
    const refusalResult = worktreeRecordReadRefusal(error);
    if (refusalResult !== null) return refusalResult;
    throw error;
  }

  const target = worktreeDir(root, task);
  const branch = record?.branch ?? worktreeBranch(root, task);
  const problem = removalProblem({ root, task, repo: repository, target, branch, record, force });

  if (problem !== null) return worktreeRefusal(problem);

  removeWorktreeState({
    repo: repository,
    target,
    branch,
    recordPath: worktreeRecordPath(root, task),
    registered: listedWorktrees(repository).some((entry) => entry.path === canonical(target)),
    force,
  });
  return { ok: true };
}

/** Fast-forward a clean task branch into its recorded main repository and remove task state.
 * This handles Git state only; lock checks and worklog writes belong to the caller.
 * @param {{ root: string, task: string }} options
 * @returns {IntegrateWorktreeResult} Integration report or a code 1/2 refusal.
 * @throws {Error} If a Git or filesystem operation fails outside expected merge refusal.
 */
export function integrateWorktree({ root, task }) {
  /** @type {WorktreeRecord | null} */
  let record;
  try {
    record = readWorktreeRecord(root, task);
  } catch (error) {
    const refusalResult = worktreeRecordReadRefusal(error);
    if (refusalResult !== null) return refusalResult;
    throw error;
  }
  if (record === null) {
    return { ok: false, code: 2, errors: ["worktree の記録がありません"] };
  }

  /** @type {string} */
  let repo;
  try {
    repo = canonical(git(record.repo, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    if (hasProcessExitStatus(error)) {
      return worktreeRefusal(
        `記録の本体リポジトリを開けません: ${processErrorText(error)}`,
      );
    }
    throw error;
  }

  const problem = integrationPreconditionProblem({ root, task, record, repo });
  if (problem !== null) return { ok: false, code: 2, errors: [problem] };

  const mainHead = git(repo, ["rev-parse", "HEAD"]).trim();
  if (!isMainHeadAncestor(repo, mainHead, record.branch)) {
    const baseBranch = record.base_ref.slice("refs/heads/".length);
    const command = `git -C ${shellArgument(record.path)} rebase ${baseBranch}`;
    return {
      ok: false,
      code: 1,
      errors: [`本体が先に進んでいます。監督が実行してください: ${command}`],
    };
  }

  const commits = Number(git(repo, ["rev-list", "--count", `HEAD..${record.branch}`]).trim());
  try {
    git(repo, ["merge", "--ff-only", record.branch]);
  } catch (error) {
    if (!hasProcessExitStatus(error)) throw error;
    return integrationFailure(error);
  }

  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["worktree", "remove", record.path]);
  git(repo, ["branch", "-d", record.branch]);
  fs.unlinkSync(worktreeRecordPath(root, task));

  return { ok: true, report: { task, repo, branch: record.branch, commits, head } };
}

/** Check whether the main HEAD is an ancestor of the task branch.
 * @param {string} repo
 * @param {string} mainHead
 * @param {string} branch
 * @returns {boolean}
 * @throws {Error} If Git fails for a reason other than a negative ancestry check.
 */
function isMainHeadAncestor(repo, mainHead, branch) {
  try {
    git(repo, ["merge-base", "--is-ancestor", mainHead, branch]);
    return true;
  } catch (error) {
    if (hasExitStatus(error, 1)) return false;
    throw error;
  }
}
