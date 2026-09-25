// @ts-check

// worktree の破棄可否を判定し、worktree・ブランチ・記録を破棄する。

import fs from "node:fs";
import { canonical } from "../../../check-task-scope.mjs";
import {
  git,
  hasProcessExitStatus,
  listedWorktrees,
  localBranchExists,
  processErrorText,
} from "../git.mjs";
import {
  isDirectory,
  isSymbolicLink,
  pathExists,
} from "./paths.mjs";
import {
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  worktreeRecordReadRefusal,
  worktreeRefusal,
  readWorktreeRecord,
} from "./record.mjs";
import { worktreeStatus } from "./state.mjs";

/** @typedef {import("../git.mjs").ListedWorktree} ListedWorktree */
/** @typedef {import("./record.mjs").WorktreeRecord} WorktreeRecord */
/** @typedef {import("./record.mjs").WorktreeRefusal} WorktreeRefusal */

/** @typedef {{ ok: true }} RemoveWorktreeSuccess */

/** @typedef {RemoveWorktreeSuccess | WorktreeRefusal} RemoveWorktreeResult */
/** @typedef {{ ok: true, removed: { worktree: boolean, branch: boolean, record: boolean },
 *   warnings?: string[] }} ForceRemoveWorktreeSuccess */

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
 * Forced removal passes --force twice so Git removes locked worktrees as well.
 * @param {{ repo: string, target: string, branch: string, recordPath: string,
 *   registered: boolean, force: boolean }} options
 * @returns {void}
 */
function removeWorktreeState({ repo, target, branch, recordPath, registered, force }) {
  if (registered) {
    git(repo, ["worktree", "remove", ...(force ? ["--force", "--force"] : []), target]);
  } else if (force && pathExists(target)) {
    fs.rmSync(target, { recursive: true, force: true });
  }

  if (localBranchExists(repo, branch)) {
    git(repo, ["branch", ...(force ? ["-D"] : ["-d"]), branch]);
  }
  if (pathExists(recordPath)) fs.unlinkSync(recordPath);
}

/** Remove a task worktree and its branch, refusing unsafe state unless force is enabled.
 * Force also removes locked worktrees and cleans orphaned task state, but never removes a branch
 * checked out elsewhere.
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

/** Remove only the task's calculated worktree, branch, and record after force preflight.
 * Registered worktrees are removed even when Git has locked them.
 * @param {{ root: string, task: string, repo: string | null }} options
 * @returns {ForceRemoveWorktreeSuccess | WorktreeRefusal} Success with prior-state fields,
 *   an optional warning, or a code 2 refusal.
 * @throws {Error} If a Git or filesystem operation fails unexpectedly.
 */
export function forceRemoveTaskWorktree({ root, task, repo }) {
  const target = worktreeDir(root, task);
  const branch = worktreeBranch(root, task);
  const recordPath = worktreeRecordPath(root, task);
  if (isSymbolicLink(target)) {
    return worktreeRefusal("置き場がシンボリックリンクのため破棄できません");
  }

  const entries = repo === null ? [] : listedWorktrees(repo);
  const targetCanonical = canonical(target);
  const targetEntry = entries.find((entry) => entry.path === targetCanonical);
  const otherCheckout = entries.find(
    (entry) => entry.branch === `refs/heads/${branch}` && entry.path !== targetCanonical,
  );
  if (otherCheckout !== undefined) {
    return worktreeRefusal("ブランチが別の場所で checkout されています");
  }

  const removed = {
    worktree: pathExists(target) || targetEntry !== undefined,
    branch: repo !== null && localBranchExists(repo, branch),
    record: pathExists(recordPath),
  };
  if (repo === null) {
    if (removed.worktree) fs.rmSync(target, { recursive: true, force: true });
    if (removed.record) fs.unlinkSync(recordPath);
    return { ok: true, removed, warnings: ["本体リポジトリが見つからず、ブランチを確認できなかった"] };
  }

  removeWorktreeState({
    repo,
    target,
    branch,
    recordPath,
    registered: targetEntry !== undefined,
    force: true,
  });
  return { ok: true, removed };
}
