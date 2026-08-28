import assert from "node:assert/strict";
import { test } from "node:test";
import { editedLineRanges, lineInScope, rangeInScope, translateLineRanges } from "../scope.mjs";

test("editedLineRanges: 単一出現の行(0-indexed)を返す", () => {
  const source = "line0\nline1\nTARGET\nline3\n";
  const ranges = editedLineRanges(source, "TARGET");
  assert.deepEqual([...ranges], [2]);
});

test("editedLineRanges: 複数行にまたがる new_string は全行を含める", () => {
  const source = "line0\nAAA\nBBB\nline3\n";
  const ranges = editedLineRanges(source, "AAA\nBBB");
  assert.deepEqual([...ranges].sort(), [1, 2]);
});

test("editedLineRanges: 複数出現があれば全て対象にする(非重複)", () => {
  const source = "X\nY\nX\nZ\nX\n";
  const ranges = editedLineRanges(source, "X");
  assert.deepEqual([...ranges].sort(), [0, 2, 4]);
});

test("editedLineRanges: 出現が見つからない場合は空集合", () => {
  const source = "line0\nline1\n";
  const ranges = editedLineRanges(source, "not-here");
  assert.equal(ranges.size, 0);
});

test("editedLineRanges: new_string が空文字なら空集合", () => {
  const ranges = editedLineRanges("line0\nline1\n", "");
  assert.equal(ranges.size, 0);
});

test("lineInScope: lineRanges 未指定なら常に true", () => {
  assert.equal(lineInScope(undefined, 5), true);
});

test("lineInScope: 範囲内・範囲外を正しく判定する", () => {
  const ranges = new Set([1, 2]);
  assert.equal(lineInScope(ranges, 1), true);
  assert.equal(lineInScope(ranges, 3), false);
});

test("rangeInScope: lineRanges 未指定なら常に true", () => {
  assert.equal(rangeInScope(undefined, 0, 100), true);
});

test("rangeInScope: 範囲が 1 行でも交差すれば true", () => {
  const ranges = new Set([5]);
  assert.equal(rangeInScope(ranges, 3, 5), true);
  assert.equal(rangeInScope(ranges, 6, 10), false);
});

test("translateLineRanges: lineRanges 未指定なら undefined を返す", () => {
  assert.equal(translateLineRanges(undefined, new Set([1])), undefined);
});

test("translateLineRanges: 挿入境界が無ければそのまま返す", () => {
  const ranges = new Set([1, 2]);
  assert.equal(translateLineRanges(ranges, new Set()), ranges);
});

test("translateLineRanges: 境界以降の行を挿入数だけ後ろへずらす", () => {
  const ranges = new Set([0, 2, 3, 4]);
  const translated = translateLineRanges(ranges, new Set([1, 4]));
  // 行0: 境界(1,4)のどちらも0より大きい → シフト0
  // 行2,3: 境界1のみ <= 自身 → シフト1
  // 行4: 境界1,4 両方 <= 自身 → シフト2
  assert.deepEqual([...translated].sort((a, b) => a - b), [0, 3, 4, 6]);
});
