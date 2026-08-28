import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { shouldFormat } from "../gate.mjs";

// 実ホームディレクトリに `~/.claude/rules/markdown.md` が存在するかに依存せず
// テストを決定的にするため、常に存在しないダミーパスを userHome として注入する。
const NO_USER_RULE_HOME = mkdtempSync(join(tmpdir(), "markdown-format-no-user-rule-"));

function makeProject({ withRule = true, paths = ['"**/*.md"'] } = {}) {
  const root = mkdtempSync(join(tmpdir(), "markdown-format-gate-"));
  if (withRule) {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    const body = ["---", "paths:", ...paths.map((p) => `  - ${p}`), "---", "", "# rule"].join(
      "\n",
    );
    writeFileSync(join(root, ".claude", "rules", "markdown.md"), body, "utf8");
  }
  return root;
}

test("rules/markdown.md が無いプロジェクトでは no-op", () => {
  const root = makeProject({ withRule: false });
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rules/markdown.md があり paths: にマッチすれば true", () => {
  const root = makeProject();
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("paths: にマッチしないファイルは false", () => {
  const root = makeProject({ paths: ['"docs/**/*.md"'] });
  try {
    assert.equal(shouldFormat(join(root, "other", "a.md"), root, NO_USER_RULE_HOME), false);
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("プロジェクトルート外のファイルは false", () => {
  const root = makeProject();
  try {
    assert.equal(shouldFormat("/tmp/outside.md", root, NO_USER_RULE_HOME), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("プロジェクトに rules が無くてもユーザーレベルの rules がマッチすれば true", () => {
  const root = makeProject({ withRule: false });
  const userHome = mkdtempSync(join(tmpdir(), "markdown-format-user-rule-"));
  mkdirSync(join(userHome, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(userHome, ".claude", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, userHome), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});
