// T の作業 worktree を本体へ統合するコマンド。

import path from "node:path";
import { gitRoot, lockRoot } from "../git.mjs";
import { readWorktreeRecordForRun } from "../worktree/record.mjs";
import { activeWorkerLock } from "../../../check-task-scope.mjs";
import { integrateWorktree } from "../worktree.mjs";
import { emit, recordWorklog } from "../output.mjs";

/** Fast-forward a task worktree after checking its worktree and main repository locks.
 * @param {{ root?: string, task?: string }} args Ledger root and task identifier.
 * @returns {void} Emits the integration report and sets the command exit code.
 * @throws {Error} If an unexpected record, lock, or integration operation fails.
 */
export function integrateTask(args) {
  const requestedRoot = path.resolve(args.root ?? ".");
  const root = gitRoot(requestedRoot);
  const task = args.task;
  const errors = [];
  if (!root) errors.push(`git のリポジトリではない: ${requestedRoot}`);
  if (!/^T\d+$/.test(task ?? "")) errors.push("--task は T<n>");
  if (errors.length > 0) {
    emit({ errors }, null, 2);
    return;
  }

  const { record, errors: recordErrors } = readWorktreeRecordForRun(root, task);
  if (recordErrors.length > 0) {
    emit({ errors: recordErrors }, null, 2);
    return;
  }

  if (record) {
    const worktreeLock = activeWorkerLock(lockRoot(record.path));
    const mainLock = activeWorkerLock(lockRoot(record.repo));
    const running = worktreeLock ?? mainLock;
    if (running) {
      emit({ errors: [`別の worker が実行中: ${running.task} ステップ ${running.step}`] }, null, 2);
      return;
    }
  }

  const result = integrateWorktree({ root, task });
  if (!result.ok) {
    emit({ errors: result.errors }, null, result.code);
    return;
  }

  recordWorklog(root, task, {
    kind: "integrate",
    by: "runner",
    keys: { branch: result.report.branch, commits: result.report.commits },
    text: "worktree を本体へ統合",
  });
  emit(result.report, null, 0);
}
