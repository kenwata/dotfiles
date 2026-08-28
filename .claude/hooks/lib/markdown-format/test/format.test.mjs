import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMarkdown } from "../format.mjs";

test("CJK に隣接する bold の外側にスペースを入れる", () => {
  const { text, changed } = formatMarkdown("日本語**重要**日本語\n");
  assert.equal(text, "日本語 **重要** 日本語\n");
  assert.equal(changed, true);
});

test("全角約物に隣接する側にはスペースを入れない", () => {
  const { text, changed } = formatMarkdown("**「重要」**。\n");
  assert.equal(text, "**「重要」**。\n");
  assert.equal(changed, false);
});

test("すでにスペースがある場合は変更しない", () => {
  const { changed } = formatMarkdown("日本語 **重要** 日本語\n");
  assert.equal(changed, false);
});

test("inline code の外側にもスペースを入れる", () => {
  const { text } = formatMarkdown("設定は`~/.claude`です\n");
  assert.equal(text, "設定は `~/.claude` です\n");
});

test("strikethrough の外側にもスペースを入れる", () => {
  const { text } = formatMarkdown("日本語~~削除~~日本語\n");
  assert.equal(text, "日本語 ~~削除~~ 日本語\n");
});

test("inline math の外側にもスペースを入れる", () => {
  const { text } = formatMarkdown("日本語$E=mc^2$日本語\n");
  assert.equal(text, "日本語 $E=mc^2$ 日本語\n");
});

test("1文字が2つの装飾に挟まれる場合は両側にスペースを入れる", () => {
  const { text } = formatMarkdown("**A**あ**B**\n");
  assert.equal(text, "**A** あ **B**\n");
});

test("3 backticks の fence を 4 backticks に昇格する", () => {
  const { text, changed } = formatMarkdown("前\n\n```js\ncode\n```\n\n後\n");
  assert.equal(text, "前\n\n````js\ncode\n````\n\n後\n");
  assert.equal(changed, true);
});

test("開始・終了の backtick 数が食い違う場合は開始側に合わせる", () => {
  const { text } = formatMarkdown("````js\ncode\n`````\nend\n");
  assert.equal(text, "````js\ncode\n````\n\nend\n");
});

test("内容に3連続backtickを含む場合は4より大きい数へ昇格する", () => {
  const src = "````\n```\ninner\n```\n````\n";
  const { text, changed } = formatMarkdown(src);
  assert.equal(changed, false, "内容の最大連続数+1(4)は既存の4で満たされるため変更なし");
  assert.equal(text, src);
});

test("すでに十分な backtick 数のネストは変更しない", () => {
  const src = "`````markdown\n```js\ncode\n```\n`````\n";
  const { changed } = formatMarkdown(src);
  assert.equal(changed, false);
});

test("閉じ fence が見つからない場合は自動修正しない", () => {
  const src = "`````js\ncode\n````\nend\n";
  const { changed, text } = formatMarkdown(src);
  assert.equal(changed, false);
  assert.equal(text, src);
});

test("root 直下の fence の前後に空行を入れる", () => {
  const { text, changed } = formatMarkdown("前\n````js\ncode\n````\n後\n");
  assert.equal(text, "前\n\n````js\ncode\n````\n\n後\n");
  assert.equal(changed, true);
});

test("list 内の fence には空行を入れない(字下げの意味を変えるため)", () => {
  const src = "- item\n\n  ````js\n  code\n  ````\n\n- item2\n";
  const { text } = formatMarkdown(src);
  assert.equal(text, src);
});

test("list 内の fence でも backtick 数の昇格は行う", () => {
  const src = "- item\n\n  ```js\n  code\n  ```\n\n- item2\n";
  const { text, changed } = formatMarkdown(src);
  assert.equal(changed, true);
  assert.equal(text, "- item\n\n  ````js\n  code\n  ````\n\n- item2\n");
});

test("深い list のネストは formatter では変更しない(rules/linter の領分)", () => {
  const src = "- a\n  - b\n    - c\n";
  const { changed } = formatMarkdown(src);
  assert.equal(changed, false);
});

test("glob っぽい ** はそもそも strong としてパースされないため対象外", () => {
  const src = "対象は **/*.md と **/*.mdx です\n";
  const { changed } = formatMarkdown(src);
  assert.equal(changed, false);
});

// --- 依存ゼロ書き直し時の追加ケース(remark 版実測との等価性と、意図的差分の固定) ---

test("全角約物に挟まれて strong 不成立の ** には触らない(lint の領分)", () => {
  const { changed } = formatMarkdown("語**「重要」**語\n");
  assert.equal(changed, false);
});

test("インデント式 code block 内の装飾記号には触らない", () => {
  const { changed } = formatMarkdown("前\n\n    code**x**日本語\n");
  assert.equal(changed, false);
});

test("インデント式 code block には空行を挿入しない(remark 版からの意図的変更)", () => {
  const src = "前\n\n    code\n直後の段落\n";
  const { text } = formatMarkdown(src);
  assert.equal(text, src);
});

test("tilde fence は昇格しないが root なら空行は入れる", () => {
  const { text } = formatMarkdown("前\n~~~js\ncode\n~~~\n後\n");
  assert.equal(text, "前\n\n~~~js\ncode\n~~~\n\n後\n");
});

test("深い list 内(絶対 indent 4 以上)の fence は昇格しない", () => {
  const src = "- a\n  - b\n\n    ```js\n    code\n    ```\n";
  const { changed } = formatMarkdown(src);
  assert.equal(changed, false);
});

test("複数行にまたがる strong は触らない(行単位走査による意図的差分)", () => {
  const src = "日本語**重\n要**語\n";
  const { text } = formatMarkdown(src);
  assert.equal(text, src);
});

test("table cell 内の装飾にはスペースを入れる", () => {
  const { text } = formatMarkdown("| a | b |\n| --- | --- |\n| x | 値**強調**値 |\n");
  assert.equal(text, "| a | b |\n| --- | --- |\n| x | 値 **強調** 値 |\n");
});

test("frontmatter 内の ** には触らない", () => {
  const src = "---\ntitle: a**b**c\n---\n\n本文\n";
  const { changed } = formatMarkdown(src);
  assert.equal(changed, false);
});

test("blockquote 内の装飾にもスペースを入れる", () => {
  const { text } = formatMarkdown("> 日本語**重要**日本語\n");
  assert.equal(text, "> 日本語 **重要** 日本語\n");
});

test("隣接する 2 つの fence の間の空行は 1 行だけ入れる", () => {
  const { text } = formatMarkdown("````\na\n````\n````\nb\n````\n");
  assert.equal(text, "````\na\n````\n\n````\nb\n````\n");
});

// --- 実害バグの回帰(PhysicalAI-research/国内企業調査 で発生した実例、2026-08-28) ---

test("中黒(・)の前後にはスペースを入れない(約物を単語文字扱いしない)", () => {
  const { changed } = formatMarkdown("`file-history/`・`sessions/` は共有せず\n");
  assert.equal(changed, false);
});

// --- lineRanges スコープ(hook の Edit スコープ限定、scope.mjs 参照) ---

test("lineRanges 指定時は範囲外の装飾スペースを挿入しない", () => {
  const src = "日本語**A**日本語\n日本語**B**日本語\n";
  const { text, changed } = formatMarkdown(src, { lineRanges: new Set([1]) });
  assert.equal(text, "日本語**A**日本語\n日本語 **B** 日本語\n");
  assert.equal(changed, true);
});

test("lineRanges が対象行を含まなければ無変更", () => {
  const src = "日本語**A**日本語\n";
  const { changed } = formatMarkdown(src, { lineRanges: new Set([5]) });
  assert.equal(changed, false);
});

test("lineRanges 指定時は範囲外の fence 昇格・空行挿入を行わない", () => {
  const src = "前\n```js\ncode\n```\n後\n\n前2\n```js\ncode2\n```\n後2\n";
  // 2 つ目の fence(行 6〜9、0-indexed)だけを範囲に含める
  const { text } = formatMarkdown(src, { lineRanges: new Set([7]) });
  assert.equal(text, "前\n```js\ncode\n```\n後\n\n前2\n\n````js\ncode2\n````\n\n後2\n");
});

test("lineRanges 省略時は従来どおり全行が対象", () => {
  const src = "日本語**A**日本語\n日本語**B**日本語\n";
  const { text } = formatMarkdown(src);
  assert.equal(text, "日本語 **A** 日本語\n日本語 **B** 日本語\n");
});

test("lineRanges 省略時、戻り値の lineRanges は undefined", () => {
  const { lineRanges } = formatMarkdown("日本語**A**日本語\n");
  assert.equal(lineRanges, undefined);
});

// --- 実害バグの回帰(diff-reviewer の指摘、2026-08-28): 空行挿入による行シフト ---
// fence 前後への空行挿入は行を追加するため、整形前基準で作った lineRanges を
// そのまま整形後のテキストに使うと、挿入位置より後ろの行が対象からずれる。
// formatMarkdown は挿入分を補正した lineRanges を返すことでこれを防ぐ。

test("空行挿入で後続行がずれても、戻り値の lineRanges は補正済みになる", () => {
  const src = "前文\n```js\ncode\n```\n語**「あ」**語\n";
  const ranges = new Set([0, 1, 2, 3, 4]);
  const result = formatMarkdown(src, { lineRanges: ranges });
  // fence の前後に空行が 1 行ずつ挿入され、元の行4(語**「あ」**語)は行6へ移動する
  assert.equal(result.text, "前文\n\n````js\ncode\n````\n\n語**「あ」**語\n");
  assert.ok(result.lineRanges.has(6));
});

test("table の別セルにある閉じられない ** と誤って対応付けない(セル跨ぎペアリングの回避)", () => {
  // 修正前は行全体を 1 本の文字列として emphasis を走査していたため、1 列目の
  // 開きにしかなれない ** (直前が全角約物)が 2 列目の ** と誤ってペアになり、
  // 「それは**表**であり」の内側(開き ** の直後)にスペースが挿入されて
  // CommonMark のレンダリングが壊れた(左 flanking 条件を破壊)。
  const src = "| a | b |\n| --- | --- |\n| 。**推奨 | それは**表**であり |\n";
  const { text, changed } = formatMarkdown(src);
  assert.equal(changed, true);
  assert.equal(text, "| a | b |\n| --- | --- |\n| 。**推奨 | それは **表** であり |\n");
});
