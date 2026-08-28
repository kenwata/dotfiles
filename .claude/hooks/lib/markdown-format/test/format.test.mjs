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
