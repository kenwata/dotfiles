// @ts-check

// 並列ステップ(run --worktree --parallel)の起動前検査を持つ。同じ T の並列ステップどうしだけを同時に走らせ、
// 同時数の上限と許可パスの重なりを機械で止める。許可パスが重ならなければ、ステップの worktree を T の worktree へ
// 統合する時に衝突しない(worktree/steps.mjs)。--parallel の無い run は、従来どおり帳簿の root で動く worker が
// 1 つでもあれば拒否される(commands/run.mjs)ので、並列ステップが走っている間に割り込まない。

import { canonical } from "../../check-task-scope.mjs";

/**
 * @typedef {object} WorkerLock
 * @property {string} root Workspace the worker writes to.
 * @property {string} [taskRoot] Ledger root of the run.
 * @property {string} task Task identifier.
 * @property {string} step Step number.
 * @property {boolean} [parallel] Whether the run was started with --parallel.
 * @property {string[]} [allowKeys] Allowed paths relative to the worktree top, for overlap checks.
 */

/** 同じ T で同時に走らせる並列ステップの既定の上限。Codex の利用枠の同時消費を 3 倍までに抑える
 * (2026-09-25 利用者決定。run の --max-parallel で変えられる) */
export const DEFAULT_MAX_PARALLEL = 3;

/** Strip a trailing slash so a directory and its spelling with "/" compare equal.
 * @param {string} value
 * @returns {string}
 */
function trimSlash(value) {
  return value.replace(/\/+$/, "");
}

/** Whether `child` is `parent` itself or a path inside it (by path segments, not by name prefix).
 * @param {string} child
 * @param {string} parent
 * @returns {boolean}
 */
function isWithin(child, parent) {
  const c = trimSlash(child);
  const p = trimSlash(parent);
  return c === p || c.startsWith(`${p}/`);
}

/** Whether any allowed path of one step equals or contains an allowed path of the other.
 * @param {string[]} left Allowed paths relative to the worktree top.
 * @param {string[]} right Allowed paths relative to the worktree top.
 * @returns {boolean}
 */
export function allowOverlaps(left, right) {
  return left.some((a) => right.some((b) => isWithin(a, b) || isWithin(b, a)));
}

/** Describe one running lock of the same ledger root that forbids starting this parallel step.
 * @param {WorkerLock} lock
 * @param {string} task
 * @param {string[]} allowKeys
 * @returns {string | null}
 */
function lockConflict(lock, task, allowKeys) {
  if (!lock.parallel) return `並列でない worker が実行中: ${lock.task} ステップ ${lock.step}`;
  if (lock.task !== task) return `別の T の worker が実行中: ${lock.task} ステップ ${lock.step}`;
  if (allowOverlaps(allowKeys, lock.allowKeys ?? [])) {
    return `許可パスが重なる並列ステップが実行中: ステップ ${lock.step}(${(lock.allowKeys ?? []).join(", ")})`;
  }
  return null;
}

/** Return why a parallel step may not start now, given the live worker locks.
 * Only locks whose ledger root is `root` count; other projects run independently.
 * @param {{ locks: WorkerLock[], root: string, task: string, allowKeys: string[],
 *   maxParallel: number }} options
 * @returns {string[]} Empty when the step may start.
 */
export function parallelLockErrors({ locks, root, task, allowKeys, maxParallel }) {
  const realRoot = canonical(root);
  const sameLedger = locks.filter((lock) => lock.taskRoot && canonical(lock.taskRoot) === realRoot);
  const errors = sameLedger
    .map((lock) => lockConflict(lock, task, allowKeys))
    .filter((error) => error !== null);

  const siblings = sameLedger.filter((lock) => lock.parallel && lock.task === task);
  if (siblings.length >= maxParallel) {
    const running = siblings.map((lock) => lock.step).join(", ");
    errors.push(`並列ステップの同時数が上限 ${maxParallel} に達している(実行中: ステップ ${running})`);
  }
  return errors;
}
