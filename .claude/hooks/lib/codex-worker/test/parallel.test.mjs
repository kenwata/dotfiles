// @ts-check

import { test } from "node:test";
import assert from "node:assert/strict";
import { allowOverlaps, parallelLockErrors } from "../parallel.mjs";

/**
 * Build a live worker lock as the runner writes it.
 * @param {Partial<import("../parallel.mjs").WorkerLock>} fields
 * @returns {import("../parallel.mjs").WorkerLock}
 */
function lock(fields) {
  return { root: "/wt/T7-s1", taskRoot: "/ledger", task: "T7", step: "1", ...fields };
}

test("allowOverlaps は同じパスと、ディレクトリとその中のパスを重なりとみなし、名前の前方一致は重ならない", () => {
  assert.equal(allowOverlaps(["src/a/impl.ts"], ["src/a/impl.ts"]), true);
  assert.equal(allowOverlaps(["src/a/"], ["src/a/impl.ts"]), true);
  assert.equal(allowOverlaps(["src/a/impl.ts"], ["src/a"]), true);
  assert.equal(allowOverlaps(["src/a/impl.ts"], ["src/a/impl.test.ts"]), false);
  assert.equal(allowOverlaps(["src/ab"], ["src/a"]), false);
  assert.equal(allowOverlaps([], ["src/a"]), false);
});

test("parallelLockErrors は兄弟の並列ステップだけが走っていて上限未満・許可パスが重ならなければ空", () => {
  const locks = [lock({ parallel: true, allowKeys: ["src/a/impl.ts"] })];

  const errors = parallelLockErrors({
    locks, root: "/ledger", task: "T7", allowKeys: ["src/a/first.ts"], maxParallel: 3,
  });

  assert.deepEqual(errors, []);
});

test("parallelLockErrors は並列でない run・別の T・上限到達・許可パスの重なりを理由付きで返す", () => {
  const request = { root: "/ledger", task: "T7", allowKeys: ["src/a/first.ts"], maxParallel: 3 };
  for (const [locks, pattern, why] of [
    [[lock({})], /並列でない worker が実行中/, "--parallel の無い run"],
    [[lock({ task: "T8", parallel: true, allowKeys: ["x"] })], /別の T の worker が実行中: T8/, "別の T"],
    [[lock({ parallel: true, allowKeys: ["src/a/"] })], /許可パスが重なる.*ステップ 1/, "許可パスの重なり"],
    [
      [
        lock({ parallel: true, allowKeys: ["a"] }),
        lock({ step: "2", parallel: true, allowKeys: ["b"] }),
      ],
      /上限 2/,
      "上限到達",
    ],
  ]) {
    const maxParallel = why === "上限到達" ? 2 : request.maxParallel;

    const typedLocks = /** @type {import("../parallel.mjs").WorkerLock[]} */ (locks);
    const errors = parallelLockErrors({ ...request, locks: typedLocks, maxParallel });

    assert.match(errors.join("\n"), /** @type {RegExp} */ (pattern), /** @type {string} */ (why));
  }
});

test("parallelLockErrors は別の帳簿の root のロックを数えない", () => {
  const locks = [lock({ taskRoot: "/other-ledger" })];

  const errors = parallelLockErrors({
    locks, root: "/ledger", task: "T7", allowKeys: ["src/a/first.ts"], maxParallel: 1,
  });

  assert.deepEqual(errors, []);
});
