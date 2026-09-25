// @ts-check

// Git 呼び出しと Git・プロセス失敗の分類を持つ。

import { execFileSync } from "node:child_process";
import { canonical } from "../../check-task-scope.mjs";

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
