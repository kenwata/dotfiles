// @ts-check

// Git 呼び出しと Git・プロセス失敗の分類を持つ。

import { execFileSync } from "node:child_process";
import path from "node:path";
import { canonical } from "../../check-task-scope.mjs";
import { trackedPaths } from "./core.mjs";

const GIT_MAX_BUFFER = 256 * 1024 * 1024;

/** @typedef {{ path: string, branch: string | null }} ListedWorktree */

/** Match a filesystem error by its stable Node.js error code.
 * @param {unknown} error
 * @param {string} code
 * @returns {boolean}
 */
export function hasErrorCode(error, code) {
  return error instanceof Error && "code" in error && error.code === code;
}

/** Match an execFileSync failure by its process exit status.
 * @param {unknown} error
 * @param {number} status
 * @returns {boolean}
 */
export function hasExitStatus(error, status) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && error.status === status;
}

/** Match an execFileSync failure that contains a child-process exit status.
 * @param {unknown} error
 * @returns {boolean}
 */
export function hasProcessExitStatus(error) {
  return typeof error === "object"
    && error !== null
    && "status" in error
    && typeof error.status === "number";
}

/** Return Git's stderr from a failed command, falling back to the process error message.
 * @param {unknown} error
 * @returns {string}
 */
export function processErrorText(error) {
  if (typeof error === "object" && error !== null && "stderr" in error) {
    const stderr = error.stderr;
    if (typeof stderr === "string" && stderr.trim() !== "") return stderr.trim();
  }
  return error instanceof Error ? error.message : String(error);
}

/** Run git in a repository and return stdout as text.
 * @param {string} repo
 * @param {string[]} args
 * @returns {string}
 */
export function git(repo, args) {
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
export function listedWorktrees(repo) {
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
export function localBranchExists(repo, branch) {
  const refs = git(repo, ["for-each-ref", "--format=%(refname)", `refs/heads/${branch}`])
    .split("\n")
    .filter(Boolean);
  return refs.includes(`refs/heads/${branch}`);
}

/** Return the current symbolic branch, or null when HEAD is detached.
 * @param {string} repo
 * @returns {string | null}
 */
export function symbolicHead(repo) {
  try {
    return git(repo, ["symbolic-ref", "-q", "HEAD"]).trim();
  } catch (error) {
    if (hasExitStatus(error, 1)) return null;
    throw error;
  }
}

/** Check whether the main HEAD is an ancestor of the task branch.
 * @param {string} repo
 * @param {string} mainHead
 * @param {string} branch
 * @returns {boolean}
 * @throws {Error} If Git fails for a reason other than a negative ancestry check.
 */
export function isMainHeadAncestor(repo, mainHead, branch) {
  try {
    git(repo, ["merge-base", "--is-ancestor", mainHead, branch]);
    return true;
  } catch (error) {
    if (hasExitStatus(error, 1)) return false;
    throw error;
  }
}

// 未コミットの変更(.gitignore 対象を除く)
export function dirtyWorktree(root) {
  return trackedPaths(root).filter((e) => !e.ignored).map((e) => e.path);
}

export function gitRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

/** Return a repository's shared Git directory, or null when the path is not a repository.
 * @param {string} dir
 * @returns {string | null}
 */
export function gitCommonDir(dir) {
  try {
    const commonDir = execFileSync("git", ["-C", dir, "rev-parse", "--git-common-dir"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return canonical(path.resolve(dir, commonDir));
  } catch {
    return null;
  }
}

/** Check repository identity across linked Git worktrees, preserving unknown when Git cannot tell.
 * @param {string} left
 * @param {string} right
 * @returns {boolean | null}
 */
export function sameGitRepository(left, right) {
  const leftCommon = gitCommonDir(left);
  const rightCommon = gitCommonDir(right);
  return leftCommon === null || rightCommon === null ? null : leftCommon === rightCommon;
}

/** Match a Node.js system error that exposes its stable error code and syscall details.
 * @param {unknown} error
 * @returns {boolean}
 */
export function hasNodeSystemErrorCode(error) {
  return error instanceof Error
    && "code" in error
    && typeof error.code === "string"
    && "errno" in error
    && typeof error.errno === "number"
    && "syscall" in error
    && typeof error.syscall === "string";
}

/** Check whether a recorded workspace resolves inside a repository, including a deleted path.
 * @param {string} workspace
 * @param {string} repo
 * @returns {boolean}
 */
export function workspaceIsInsideRepo(workspace, repo) {
  const relativeWorkspace = path.relative(repo, canonical(path.resolve(workspace)));
  if (relativeWorkspace === "") return true;
  if (
    path.isAbsolute(relativeWorkspace)
    || relativeWorkspace === ".."
    || relativeWorkspace.startsWith(`..${path.sep}`)
  ) return false;
  return true;
}

// 実行中ロックの単位。作業場所を含む git リポジトリの最上位にする。作業場所はリポジトリの中の
// サブディレクトリでもよいので、作業場所そのものを単位にすると、範囲の重なる 2 つの worker(同じ
// リポジトリの別のサブディレクトリや最上位)が同時に走り、互いの変更をゲートの違反として巻き戻す
export function lockRoot(workspace) {
  return gitRoot(workspace) ?? workspace;
}
