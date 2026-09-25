// @ts-check

// worktree の突き合わせ・作成・再利用と状態の欄を持つ。

import fs from "node:fs";
import path from "node:path";
import { canonical } from "../../../check-task-scope.mjs";
import {
  git,
  hasExitStatus,
  listedWorktrees,
  localBranchExists,
} from "../git.mjs";
import {
  isDirectory,
  isRealDirectory,
  pathExists,
} from "./paths.mjs";
import {
  refusal,
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  worktreeRefusal,
  readWorktreeRecord,
} from "./record.mjs";

/** @typedef {import("./record.mjs").WorktreeRecord} WorktreeRecord */
/** @typedef {import("./record.mjs").EnsureWorktreeRefusal} EnsureWorktreeRefusal */

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

/** @typedef {EnsureWorktreeSuccess | EnsureWorktreeRefusal} EnsureWorktreeResult */
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
