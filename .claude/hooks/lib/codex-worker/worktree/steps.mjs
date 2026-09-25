// @ts-check

// 並列ステップ(run --worktree --parallel)の作業場所になる、ステップ単位の worktree の作成・再利用と、
// T の worktree への統合を持つ。置き場とブランチは T の worktree と同じ規則で、鍵を `<T>-s<番号>` にする
// (record.mjs の worktreeDir・worktreeBranch)。起点は T の worktree のブランチの先端なので、統合済みの前の
// ステップの成果が見える。統合は、監督がステップの worktree で受け入れた変更をコミットした後、ステップの
// ブランチを T のブランチの先端へ載せ直し(rebase)、T の worktree へ fast-forward する。兄弟のステップが先に
// 統合されていても、許可パスが重ならない限り(parallel.mjs が起動前に止める)載せ直しは衝突しない。
// 記録は T の置き場の worktree-s<番号>.json に、T の worktree.json と同じ 6 キーで置く(base_ref は T のブランチ)。

import fs from "node:fs";
import path from "node:path";
import { canonical } from "../../../check-task-scope.mjs";
import {
  dirtyWorktree, git, hasErrorCode, listedWorktrees, localBranchExists, processErrorText,
} from "../git.mjs";
import { taskDir } from "../worklog.mjs";
import { isRealDirectory, pathExists } from "./paths.mjs";
import { isWorktreeRecord, worktreeBranch, worktreeDir, worktreeRefusal } from "./record.mjs";

/** @typedef {import("./record.mjs").WorktreeRecord} WorktreeRecord */
/** @typedef {{ ok: false, code: 1 | 2, errors: string[] }} StepRefusal */

/** 記録ファイル名 worktree-s<番号>.json の形 */
const STEP_RECORD_PATTERN = /^worktree-s(\d+)\.json$/;

/** Key used for the step worktree's directory and branch.
 * @param {string} task
 * @param {string} step
 * @returns {string}
 */
function stepKey(task, step) {
  return `${task}-s${step}`;
}

/** Path of the step worktree record inside the task's ledger directory.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @param {string} step Step number.
 * @returns {string}
 */
export function stepWorktreeRecordPath(root, task, step) {
  return path.join(taskDir(root, task), `worktree-s${step}.json`);
}

/** Read a step worktree record, or null when it does not exist.
 * @param {string} root
 * @param {string} task
 * @param {string} step
 * @returns {WorktreeRecord | null}
 * @throws {Error} If the record is malformed or unreadable for another reason.
 */
export function readStepWorktreeRecord(root, task, step) {
  try {
    const parsed = /** @type {unknown} */ (
      JSON.parse(fs.readFileSync(stepWorktreeRecordPath(root, task, step), "utf8"))
    );
    if (!isWorktreeRecord(parsed)) throw new TypeError("Invalid step worktree record");
    return parsed;
  } catch (error) {
    if (hasErrorCode(error, "ENOENT")) return null;
    throw error;
  }
}

/** Step numbers of the task that still have a step worktree record (not yet integrated).
 * @param {string} root
 * @param {string} task
 * @returns {string[]} Step numbers in ascending order.
 */
export function pendingStepWorktrees(root, task) {
  let names;
  try { names = fs.readdirSync(taskDir(root, task)); } catch { return []; }

  return names
    .map((name) => STEP_RECORD_PATTERN.exec(name)?.[1])
    .filter((step) => step !== undefined)
    .sort((a, b) => Number(a) - Number(b));
}

/** Refusal with the manual commands that clear a step worktree left in an inconsistent state.
 * @param {{ repo: string, target: string, branch: string, recordPath: string }} where
 * @param {string} reason
 * @returns {StepRefusal}
 */
function stepRefusal({ repo, target, branch, recordPath }, reason) {
  const recovery = [
    `git -C ${repo} worktree remove --force ${target}`,
    `git -C ${repo} branch -D ${branch}`,
    `rm ${recordPath}`,
  ].join("; ");
  return { ok: false, code: 2, errors: [`${reason}。復旧: ${recovery}`] };
}

/** Reuse the step's worktree or create it from the tip of the task worktree's branch.
 * @param {{ root: string, task: string, step: string, taskRecord: WorktreeRecord,
 *   now?: Date }} options
 * @returns {{ ok: true, created: boolean, record: WorktreeRecord } | StepRefusal}
 * @throws {Error} If a Git operation or filesystem write fails unexpectedly.
 */
export function ensureStepWorktree({ root, task, step, taskRecord, now = new Date() }) {
  const repo = taskRecord.repo;
  const target = worktreeDir(root, stepKey(task, step));
  const targetCanonical = canonical(target);
  const branch = worktreeBranch(root, stepKey(task, step));
  const recordPath = stepWorktreeRecordPath(root, task, step);
  const where = { repo, target, branch, recordPath };
  const record = readStepWorktreeRecord(root, task, step);
  const entries = listedWorktrees(repo);

  if (record !== null) {
    const listed = entries.find((entry) => entry.path === targetCanonical);
    const matches = record.branch === branch && canonical(record.path) === targetCanonical;
    if (matches && listed?.branch === `refs/heads/${branch}` && isRealDirectory(target)) {
      return { ok: true, created: false, record };
    }
    return stepRefusal(where, "ステップの worktree の記録と置き場が一致しない");
  }

  const occupied = entries.some((entry) => entry.path === targetCanonical) || pathExists(target);
  if (occupied || localBranchExists(repo, branch)) {
    return stepRefusal(where, "記録が無いのに、ステップの置き場かブランチが残っている");
  }

  const base = git(taskRecord.path, ["rev-parse", "HEAD"]).trim();
  fs.mkdirSync(path.dirname(target), { recursive: true, mode: 0o700 });
  git(repo, ["worktree", "add", "-b", branch, target, taskRecord.branch]);

  const created = {
    repo,
    path: targetCanonical,
    branch,
    base,
    base_ref: `refs/heads/${taskRecord.branch}`,
    created_at: now.toISOString(),
  };
  fs.mkdirSync(path.dirname(recordPath), { recursive: true, mode: 0o700 });
  fs.writeFileSync(recordPath, `${JSON.stringify(created, null, 2)}\n`);
  return { ok: true, created: true, record: created };
}

/** Remove the integrated step's worktree, branch, and record.
 * Collects failures instead of stopping at the first one.
 * @param {WorktreeRecord} record
 * @param {WorktreeRecord} taskRecord
 * @param {string} recordPath
 * @returns {string[]} Cleanup failures.
 */
function cleanupStep(record, taskRecord, recordPath) {
  const steps = [
    () => git(record.repo, ["worktree", "remove", record.path]),
    () => git(taskRecord.path, ["branch", "-d", record.branch]),
    () => fs.rmSync(recordPath, { force: true }),
  ];
  const failures = [];
  for (const step of steps) {
    try { step(); } catch (error) { failures.push(processErrorText(error)); }
  }
  return failures;
}

/** Rebase the step's committed changes onto the task branch and fast-forward the task worktree.
 * Refuses (code 2) without touching Git when a record is missing or a worktree has uncommitted
 * changes; stops (code 1) after undoing the rebase when the step conflicts with the task branch.
 * @param {{ root: string, task: string, step: string, taskRecord: WorktreeRecord }} options
 * @returns {{ ok: true, report: { task: string, step: string, branch: string, commits: number,
 *   cleanup_errors?: string[] } } | StepRefusal}
 * @throws {Error} If the record cannot be read.
 */
export function integrateStepWorktree({ root, task, step, taskRecord }) {
  const record = readStepWorktreeRecord(root, task, step);
  if (record === null) return worktreeRefusal(`ステップ ${step} の worktree の記録が無い`);
  if (dirtyWorktree(record.path).length > 0) {
    return worktreeRefusal(
      `ステップ ${step} の worktree に未コミットの変更がある。受け入れた変更をコミットしてから統合する: ${record.path}`,
    );
  }
  if (dirtyWorktree(taskRecord.path).length > 0) {
    return worktreeRefusal(`T の worktree に未コミットの変更がある: ${taskRecord.path}`);
  }

  try {
    git(record.path, ["rebase", taskRecord.branch]);
  } catch (error) {
    try { git(record.path, ["rebase", "--abort"]); } catch { /* rebase が始まる前に失敗した */ }
    const reason = `ステップ ${step} を T のブランチへ載せ直せない(衝突)。rebase は取り消した`;
    return { ok: false, code: 1, errors: [`${reason}: ${processErrorText(error)}`] };
  }

  const range = `HEAD..${record.branch}`;
  const commits = Number(git(taskRecord.path, ["rev-list", "--count", range]).trim());
  try {
    git(taskRecord.path, ["merge", "--ff-only", record.branch]);
  } catch (error) {
    const reason = `T の worktree へ fast-forward できない: ${processErrorText(error)}`;
    return { ok: false, code: 1, errors: [reason] };
  }

  const failures = cleanupStep(record, taskRecord, stepWorktreeRecordPath(root, task, step));
  return {
    ok: true,
    report: {
      task, step, branch: record.branch, commits,
      ...(failures.length > 0 ? { cleanup_errors: failures } : {}),
    },
  };
}
