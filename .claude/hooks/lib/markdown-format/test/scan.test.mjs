import assert from "node:assert/strict";
import { test } from "node:test";
import { scanDocument, splitTableRow, tableRowSegments } from "../scan.mjs";

test("ファイル先頭の frontmatter を認識して以降の判定から外す", () => {
  const doc = scanDocument("---\npaths:\n  - '**/*.md'\n---\n本文**あ**\n");
  assert.deepEqual(
    doc.lines.slice(0, 4).map((l) => l.kind),
    ["frontmatter", "frontmatter", "frontmatter", "frontmatter"],
  );
  assert.equal(doc.lines[4].kind, "text");
});

test("閉じの無い frontmatter もどきは frontmatter 扱いしない", () => {
  const doc = scanDocument("---\nテキスト\n");
  assert.equal(doc.lines[0].kind, "text");
});

test("fence の開閉を追跡し、内容行を fence-content にする", () => {
  const doc = scanDocument("````js\ncode**x**\n````\n");
  assert.deepEqual(
    doc.lines.slice(0, 3).map((l) => l.kind),
    ["fence-open", "fence-content", "fence-close"],
  );
  assert.equal(doc.fences.length, 1);
  assert.equal(doc.fences[0].closeLine, 2);
  assert.equal(doc.fences[0].atRoot, true);
});

test("list 内のインデント付き fence を追跡する(atRoot は false)", () => {
  const doc = scanDocument("- item\n\n  ````js\n  code\n  ````\n");
  assert.equal(doc.lines[2].kind, "fence-open");
  assert.equal(doc.fences[0].atRoot, false);
  assert.equal(doc.fences[0].absIndent, 2);
});

test("blockquote 内の閉じた fence を閉じたと判定する", () => {
  const doc = scanDocument("> 前\n> ````\n> code\n> ````\n> 後\n");
  assert.equal(doc.fences.length, 1);
  assert.equal(doc.fences[0].closeLine, 3);
  assert.equal(doc.fences[0].bqDepth, 1);
});

test("EOF まで閉じない fence は unclosed として記録する", () => {
  const doc = scanDocument("````js\ncode\n");
  assert.equal(doc.fences.length, 1);
  assert.equal(doc.fences[0].closeLine, null);
});

test("table を header + delimiter で認識する", () => {
  const doc = scanDocument("| a | b |\n| --- | --- |\n| x | y |\n");
  assert.deepEqual(
    doc.lines.slice(0, 3).map((l) => l.kind),
    ["table-row", "table-delimiter", "table-row"],
  );
});

test("setext 見出し(a | b の直後の ---)を table と誤認しない", () => {
  const doc = scanDocument("a | b\n---\n");
  assert.equal(doc.lines[0].kind, "text");
  assert.equal(doc.lines[1].kind, "text");
});

test("インデント式 code block を認識する(直前が空行のときのみ開始)", () => {
  const doc = scanDocument("段落\n\n    code**x**\n    code2\n段落続き\n");
  assert.equal(doc.lines[2].kind, "indented-code");
  assert.equal(doc.lines[3].kind, "indented-code");
  assert.equal(doc.lines[4].kind, "text");
});

test("段落直後の 4 スペース行はインデント式 code にしない(interrupt 不可)", () => {
  const doc = scanDocument("段落\n    続き\n");
  assert.equal(doc.lines[1].kind, "text");
});

test("list のネスト深さを push 単位で記録する(同階層の兄弟 item は数えない)", () => {
  const doc = scanDocument("- a\n  - b\n    - c\n    - c2\n");
  assert.deepEqual(doc.listPushes, [
    { line: 0, depth: 1 },
    { line: 1, depth: 2 },
    { line: 2, depth: 3 },
  ]);
});

test("splitTableRow はエスケープされた \\| を区切りにしない", () => {
  assert.deepEqual(splitTableRow("| a \\| b | c |"), ["a | b", "c"]);
});

test("tableRowSegments は各セルの位置(trim なし)を返す", () => {
  const content = "| a | bc |";
  const segments = tableRowSegments(content);
  assert.deepEqual(
    segments.map((s) => content.slice(s.start, s.end)),
    ["", " a ", " bc ", ""],
  );
});

test("tableRowSegments はエスケープされた \\| を区切りにしない", () => {
  const content = "| a \\| b | c |";
  const segments = tableRowSegments(content);
  assert.deepEqual(
    segments.map((s) => content.slice(s.start, s.end)),
    ["", " a \\| b ", " c ", ""],
  );
});
