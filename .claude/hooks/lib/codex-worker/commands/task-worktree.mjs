// T の作業 worktree の統合・状態表示・破棄を扱うコマンド。

import fs from "node:fs";
import path from "node:path";
import { canonical } from "../../../check-task-scope.mjs";
import {
  gitRoot,
  gitCommonDir,
  hasNodeSystemErrorCode,
  hasProcessExitStatus,
  listedWorktrees,
  localBranchExists,
  lockRoot,
  processErrorText,
} from "../git.mjs";
import { readWorktreeRecordForRun } from "../worktree/record.mjs";
import { activeWorkerLock } from "../../../check-task-scope.mjs";
import {
  integrateWorktree,
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  worktreeStatus,
} from "../worktree.mjs";
import { forceRemoveTaskWorktree, removeWorktree } from "../worktree/removal.mjs";
import { emit, recordWorklog } from "../output.mjs";

/** @typedef {import("../worktree/record.mjs").WorktreeRecord} WorktreeRecord */

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
    keys: {
      branch: result.report.branch,
      commits: result.report.commits,
      ...(result.report.cleanup_errors === undefined ? {} : { cleanup: "failed" }),
    },
    text: "worktree を本体へ統合",
  });
  emit(result.report, null, 0);
}

/** Emit the recorded task worktree's seven status fields, or only the task when absent.
 * Invalid roots and task identifiers, unreadable records, and Git failures exit with code 2.
 * @param {{ root?: string, task?: string }} args Ledger root and task identifier.
 * @returns {void} Emits one JSON report and sets the command exit code.
 */
export function worktreeTask(args) {
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

  if (args.force && !args.remove) {
    emit({ errors: ["--force は --remove と一緒に指定してください"] }, null, 2);
    return;
  }

  if (args.remove) {
    if (args.force) {
      removeTaskWorktreeForce(root, task);
    } else {
      removeTaskWorktree(root, task);
    }
    return;
  }

  try {
    const status = worktreeStatus(root, task);
    emit(status === null ? { task } : { task, worktree: status }, null, 0);
  } catch (error) {
    if (
      !(error instanceof SyntaxError)
      && !(error instanceof TypeError)
      && !hasNodeSystemErrorCode(error)
      && !hasProcessExitStatus(error)
    ) throw error;
    emit({ errors: [`worktree の状態を読めない: ${processErrorText(error)}`] }, null, 2);
  }
}

/** Resolve the main repository from a valid record or the linked worktree metadata.
 * @param {{ root: string, task: string, record: WorktreeRecord | null }} args
 * @returns {string | null} Real main repository path, or null when no Git metadata remains.
 */
function resolveMainRepository({ root, task, record }) {
  if (record !== null) {
    const recordedRepo = gitRoot(record.repo);
    if (recordedRepo !== null) return canonical(recordedRepo);
  }

  const commonDir = gitCommonDir(worktreeDir(root, task));
  return commonDir === null ? null : path.dirname(commonDir);
}

/** Remove one task worktree after validating its record and collecting the result fields.
 * @param {string} root Ledger repository root.
 * @param {string} task Valid task identifier.
 * @returns {void} Emits the removal report or a code 2 refusal.
 */
function removeTaskWorktree(root, task) {
  const { record, errors } = readWorktreeRecordForRun(root, task);
  if (errors.length > 0) {
    emit({ errors }, null, 2);
    return;
  }

  const target = worktreeDir(root, task);
  const recordPath = worktreeRecordPath(root, task);
  const recordExists = fs.existsSync(recordPath);
  const targetExists = fs.existsSync(target);
  const repository = record === null
    ? resolveMainRepository({ root, task, record })
    : gitRoot(record.repo);

  if (record === null && repository === null) {
    if (!targetExists) {
      emit({
        task,
        removed: { worktree: false, branch: false, record: recordExists },
        warnings: ["本体リポジトリが見つからず、ブランチを確認できなかった"],
      }, null, 0);
      return;
    }
    emit({
      errors: ["本体リポジトリが見つかりません。残った worktree は --force で破棄できます"],
    }, null, 2);
    return;
  }

  try {
    const removed = taskWorktreeRemovalState(root, task, repository, targetExists, recordExists);

    const result = removeWorktree({ root, task, repo: record?.repo ?? repository });
    if (!result.ok) {
      emit({ errors: result.errors }, null, result.code);
      return;
    }
    emit({ task, removed }, null, 0);
  } catch (error) {
    if (
      !(error instanceof SyntaxError)
      && !(error instanceof TypeError)
      && !hasNodeSystemErrorCode(error)
      && !hasProcessExitStatus(error)
    ) throw error;
    emit({ errors: [`worktree を破棄できません: ${processErrorText(error)}`] }, null, 2);
  }
}

/** Remove calculated task state regardless of record validity, while preserving safety refusals.
 * @param {string} root Ledger repository root.
 * @param {string} task Valid task identifier.
 * @returns {void} Emits the removal report or a code 2 refusal.
 */
function removeTaskWorktreeForce(root, task) {
  const { record } = readWorktreeRecordForRun(root, task);
  const repository = resolveMainRepository({ root, task, record });

  try {
    const result = forceRemoveTaskWorktree({ root, task, repo: repository });
    if (!result.ok) {
      emit({ errors: result.errors }, null, result.code);
      return;
    }
    emit({
      task,
      removed: result.removed,
      ...(result.warnings === undefined ? {} : { warnings: result.warnings }),
    }, null, 0);
  } catch (error) {
    if (!hasNodeSystemErrorCode(error) && !hasProcessExitStatus(error)) throw error;
    emit({ errors: [`worktree を破棄できません: ${processErrorText(error)}`] }, null, 2);
  }
}

/** Capture calculated worktree, branch, and record state before removal.
 * @param {string} root Ledger repository root.
 * @param {string} task Task identifier.
 * @param {string | null} repository Resolved main repository path.
 * @param {boolean} targetExists Whether the calculated worktree path exists.
 * @param {boolean} recordExists Whether the calculated record exists.
 * @returns {{ worktree: boolean, branch: boolean, record: boolean }} Prior state fields.
 */
function taskWorktreeRemovalState(root, task, repository, targetExists, recordExists) {
  const target = worktreeDir(root, task);
  const entries = repository === null ? [] : listedWorktrees(repository);
  return {
    worktree: targetExists || entries.some((entry) => entry.path === canonical(target)),
    branch: repository !== null && localBranchExists(repository, worktreeBranch(root, task)),
    record: recordExists,
  };
}
