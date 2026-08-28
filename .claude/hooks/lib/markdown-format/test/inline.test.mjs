import assert from "node:assert/strict";
import { test } from "node:test";
import { formatMarkdown } from "../format.mjs";
import { scanInline } from "../inline.mjs";

// inline 走査の要は「remark と同じものだけを装飾として認める」こと。
// span 検出そのものと、formatter を通した最終挙動の両面から固定する。

test("snake_case 識別子の _ は emphasis にしない(intraword)", () => {
  const { changed } = formatMarkdown("値はfoo_bar_bazです\n");
  assert.equal(changed, false);
});

test("日本語文中の _ も emphasis にしない", () => {
  const { changed } = formatMarkdown("日本語_強調_日本語\n");
  assert.equal(changed, false);
});

test("* は intraword でも emphasis になる(CommonMark 準拠)", () => {
  const { text } = formatMarkdown("foo*bar*baz\n");
  assert.equal(text, "foo *bar* baz\n");
});

test("backslash エスケープされた ** は装飾にしない", () => {
  const { changed } = formatMarkdown("日本語\\*\\*not bold\\*\\*日本語\n");
  assert.equal(changed, false);
});

test("code span 内の ** は装飾にしない", () => {
  const { text, changed } = formatMarkdown("`a **b** c`\n");
  assert.equal(changed, false);
  assert.equal(text, "`a **b** c`\n");
});

test("link destination 内の * には触らない", () => {
  const { changed } = formatMarkdown("[x](http://example.com/あ*y*い)\n");
  assert.equal(changed, false);
});

test("通貨表記の $ は inline math にしない(閉じ $ の直後が数字)", () => {
  const { changed } = formatMarkdown("価格は$5 と $6です\n");
  assert.equal(changed, false);
});

test("単一チルダの打ち消しにもスペースを入れる(remark-gfm singleTilde 相当)", () => {
  const { text } = formatMarkdown("日本語~削除~日本語\n");
  assert.equal(text, "日本語 ~削除~ 日本語\n");
});

test("3 連以上のチルダは打ち消しにしない(GFM 準拠)", () => {
  const { changed } = formatMarkdown("日本語~~~削除~~~日本語\n");
  assert.equal(changed, false);
});

test("ネストした装飾は内側にもスペースを入れる(remark の AST walk と同じ)", () => {
  const { text } = formatMarkdown("**あ*い*う**\n");
  assert.equal(text, "**あ *い* う**\n");
});

test("run 長が一致しないデリミタ対は安全側に倒して触らない", () => {
  const { changed } = formatMarkdown("日本語**強調*日本語\n");
  assert.equal(changed, false);
});

test("scanInline: code span は N 連 backtick をちょうど N 連で閉じる", () => {
  const { spans } = scanInline("``a ` b`` rest");
  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, "code");
  assert.equal(spans[0].start, 0);
  assert.equal(spans[0].end, 9);
});

test("scanInline: 全角約物が隣接する ** は span にならない(flanking 不成立)", () => {
  const { spans } = scanInline("語**「重要」**語");
  assert.deepEqual(spans, []);
});

test("scanInline: 行頭の **「重要」**。 は span になる(remark と同じ)", () => {
  const { spans } = scanInline("**「重要」**。");
  assert.equal(spans.length, 1);
  assert.equal(spans[0].type, "emphasis");
});
