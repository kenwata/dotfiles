import assert from "node:assert/strict";
import { test } from "node:test";
import { lintMarkdown } from "../lint.mjs";

function rules(findings) {
  return findings.map((f) => f.rule);
}

test("閉じ fence が無い場合に検出する", () => {
  const findings = lintMarkdown("`````js\ncode\n````\nend\n");
  assert.ok(rules(findings).includes("fence-unclosed-or-malformed"));
});

test("正しい fence は検出しない", () => {
  const findings = lintMarkdown("前\n\n````js\ncode\n````\n\n後\n");
  assert.deepEqual(rules(findings), []);
});

test("地の文に残った ** らしき記号を検出する", () => {
  const findings = lintMarkdown("語**「重要」**語\n");
  assert.ok(rules(findings).includes("possible-unrendered-bold"));
});

test("glob っぽい ** は誤検出しない", () => {
  const findings = lintMarkdown("対象は **/*.md にマッチする\n");
  assert.deepEqual(
    findings.filter((f) => f.rule === "possible-unrendered-bold"),
    [],
  );
});

test("長い table cell を検出する", () => {
  const src = [
    "| a | b |",
    "| --- | --- |",
    "| x | " + "あ".repeat(41) + " |",
  ].join("\n") + "\n";
  const findings = lintMarkdown(src);
  assert.ok(rules(findings).includes("table-cell-too-complex"));
});

test("短い table cell は検出しない", () => {
  const src = ["| a | b |", "| --- | --- |", "| x | y |"].join("\n") + "\n";
  const findings = lintMarkdown(src);
  assert.deepEqual(
    findings.filter((f) => f.rule === "table-cell-too-complex"),
    [],
  );
});

test("3階層以上の list ネストを検出する", () => {
  const findings = lintMarkdown("- a\n  - b\n    - c\n");
  assert.ok(rules(findings).includes("list-too-deep"));
});

test("2階層までの list は検出しない", () => {
  const findings = lintMarkdown("- a\n  - b\n");
  assert.deepEqual(
    findings.filter((f) => f.rule === "list-too-deep"),
    [],
  );
});

// --- 依存ゼロ書き直し時の追加ケース ---

test("blockquote 内の閉じた fence を誤検出しない(remark 版のバグ修正)", () => {
  const findings = lintMarkdown("> 前\n> ````\n> code\n> ````\n> 後\n");
  assert.deepEqual(rules(findings), []);
});

test("blockquote 内の未閉 fence は検出する", () => {
  const findings = lintMarkdown("> ````\n> code\n\n本文\n");
  assert.ok(rules(findings).includes("fence-unclosed-or-malformed"));
});

test("成立する装飾は同一行に複数あっても検出しない", () => {
  const findings = lintMarkdown("語**あ**語と語~~い~~語のどちらも約物なし\n");
  assert.deepEqual(rules(findings), []);
});

test("約物隣接で不成立の ** と ~~ が同一行にあれば両方検出する", () => {
  const findings = lintMarkdown("語**「あ」**語と語~~「い」~~語\n");
  assert.deepEqual(rules(findings), [
    "possible-unrendered-bold",
    "possible-unrendered-strikethrough",
  ]);
});

test("深いインデントの list 内で閉じた fence を誤検出しない(remark 版のバグ修正)", () => {
  const findings = lintMarkdown("- a\n\n  1. b\n\n     ````\n     code\n     ````\n");
  assert.deepEqual(rules(findings), []);
});

test("非 BMP 文字(絵文字)を含む行で span がずれて誤検出しない", () => {
  const findings = lintMarkdown("😀😀😀😀😀😀😀😀 `**ab** more code content` tail\n");
  assert.deepEqual(rules(findings), []);
});
