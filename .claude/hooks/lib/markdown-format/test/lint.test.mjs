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

// --- lineRanges スコープ(hook の Edit スコープ限定、scope.mjs 参照) ---

test("lineRanges 指定時は範囲外の finding を報告しない", () => {
  const src = "語**「あ」**語\n本文\n";
  const findings = lintMarkdown(src, { lineRanges: new Set([1]) });
  assert.deepEqual(rules(findings), []);
});

test("lineRanges 指定時は範囲内の finding は報告する", () => {
  const src = "本文\n語**「あ」**語\n";
  const findings = lintMarkdown(src, { lineRanges: new Set([1]) });
  assert.ok(rules(findings).includes("possible-unrendered-bold"));
});

test("lineRanges 未指定時は従来どおり全行が対象", () => {
  const findings = lintMarkdown("語**「あ」**語\n");
  assert.ok(rules(findings).includes("possible-unrendered-bold"));
});

test("未閉 fence は範囲が交差する限り報告する(範囲アンカーの扱い)", () => {
  const src = "本文\n`````js\ncode\n````\nend\n";
  // fence の開き行(1)は範囲外だが、fence の範囲(1〜末尾)が範囲内の行4と交差する
  const findings = lintMarkdown(src, { lineRanges: new Set([4]) });
  assert.ok(rules(findings).includes("fence-unclosed-or-malformed"));
});

test("未閉 fence の範囲外(fence 出現より前の行)だけが編集範囲なら報告しない", () => {
  const src = "本文A\n本文B\n`````js\ncode\n````\nend\n";
  const findings = lintMarkdown(src, { lineRanges: new Set([0]) });
  assert.deepEqual(
    findings.filter((f) => f.rule === "fence-unclosed-or-malformed"),
    [],
  );
});

// --- 実害バグの回帰(PhysicalAI-research/国内企業調査 で発生した実例、2026-08-28) ---

test("table の別セルにまたがる ** を残留装飾記号として誤検出しない(セル境界の mask)", () => {
  const findings = lintMarkdown("| a | b |\n| --- | --- |\n| 。**推奨 | それは**表**であり |\n");
  assert.deepEqual(rules(findings), []);
});
