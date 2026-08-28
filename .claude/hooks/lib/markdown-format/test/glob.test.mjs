import assert from "node:assert/strict";
import { test } from "node:test";
import { globMatch } from "../glob.mjs";

test("**/*.md はルート直下のファイルにもマッチする", () => {
  assert.equal(globMatch("a.md", ["**/*.md"]), true);
  assert.equal(globMatch("docs/a/b.md", ["**/*.md"]), true);
});

test("ディレクトリ指定のパターンは外のファイルにマッチしない", () => {
  assert.equal(globMatch("other/a.md", ["docs/**/*.md"]), false);
  assert.equal(globMatch("docs/a.md", ["docs/**/*.md"]), true);
});

test("* はパス区切りを跨がない", () => {
  assert.equal(globMatch("docs/a.md", ["*.md"]), false);
});

test("dot ファイルにもマッチする(micromatch の dot: true 相当)", () => {
  assert.equal(globMatch(".hidden/a.md", ["**/*.md"]), true);
});

test("ブレース展開 {md,mdx} を 1 段展開する", () => {
  assert.equal(globMatch("a.mdx", ["**/*.{md,mdx}"]), true);
  assert.equal(globMatch("a.txt", ["**/*.{md,mdx}"]), false);
});

test("複数パターンはいずれかにマッチすればよい", () => {
  assert.equal(globMatch("src/x.mdx", ["**/*.md", "**/*.mdx"]), true);
});
