import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { shouldFormat } from "../gate.mjs";

// 実ホームディレクトリに `~/.claude/rules/markdown.md` が存在するかに依存せず
// テストを決定的にするため、常に存在しないダミーパスを userHome として注入する。
const NO_USER_RULE_HOME = mkdtempSync(join(tmpdir(), "markdown-format-no-user-rule-"));

function makeProject({ withRule = true, paths = ['"**/*.md"'], product = "claude" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "markdown-format-gate-"));
  if (withRule) {
    const productDir = product === "codex" ? ".codex" : ".claude";
    mkdirSync(join(root, productDir, "rules"), { recursive: true });
    const body = ["---", "paths:", ...paths.map((p) => `  - ${p}`), "---", "", "# rule"].join(
      "\n",
    );
    writeFileSync(join(root, productDir, "rules", "markdown.md"), body, "utf8");
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

// Claude Code から呼ばれた場合(ruleDirs 未指定 = 既定 [".claude"])は、
// Codex-native な .codex/rules/markdown.md だけを根拠に true になってはならない
// (Claude Code はこのファイルをロードしないため)。
test("既定(ruleDirs 未指定)では .codex/rules/markdown.md はプロジェクトレベルでも無視される", () => {
  const root = makeProject({ product: "codex" });
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("既定(ruleDirs 未指定)では .codex/rules/markdown.md はユーザーレベルでも無視される", () => {
  const root = makeProject({ withRule: false });
  const userHome = mkdtempSync(join(tmpdir(), "markdown-format-user-rule-"));
  mkdirSync(join(userHome, ".codex", "rules"), { recursive: true });
  writeFileSync(
    join(userHome, ".codex", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, userHome), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
  }
});

// 両方に rules があり paths: が食い違う場合、既定では .claude 側の判定だけに従う
// (和集合に広がらない)。Codex 側だけがマッチする場合は false のままであること。
test("既定では両方存在し paths: が食い違っても .codex 側の一致だけでは true にならない", () => {
  const root = mkdtempSync(join(tmpdir(), "markdown-format-gate-"));
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "rules", "markdown.md"),
    ["---", "paths:", '  - "docs/**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  mkdirSync(join(root, ".codex", "rules"), { recursive: true });
  writeFileSync(
    join(root, ".codex", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  try {
    assert.equal(shouldFormat(join(root, "other", "a.md"), root, NO_USER_RULE_HOME), false);
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Codex アダプター(.codex/hooks/format-markdown.mjs)が実際に渡すのと同じ
// ruleDirs=[".codex", ".claude"] を明示指定した場合のみ、.codex/rules/markdown.md が
// 根拠になってよい(opt-in)。
test("ruleDirs で明示指定した場合のみ .codex/rules/markdown.md が根拠になる(opt-in)", () => {
  const root = makeProject({ product: "codex" });
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME), false);
    assert.equal(
      shouldFormat(join(root, "docs", "a.md"), root, NO_USER_RULE_HOME, [".codex", ".claude"]),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ruleDirs はプロジェクトレベルとユーザーレベルの両方に一様に適用する(実装の
// 第 2 ループ)。この正例が無いと、ユーザーレベル側を `.claude` 固定に戻す退行を
// 検出できない(2026-08-30、diff-reviewer の指摘で追加)。
test("ユーザーレベルの rules にも ruleDirs が適用される(既定では .codex を見ない)", () => {
  const root = makeProject({ withRule: false });
  const userHome = mkdtempSync(join(tmpdir(), "markdown-format-user-rule-"));
  mkdirSync(join(userHome, ".codex", "rules"), { recursive: true });
  writeFileSync(
    join(userHome, ".codex", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  try {
    assert.equal(shouldFormat(join(root, "docs", "a.md"), root, userHome), false);
    assert.equal(
      shouldFormat(join(root, "docs", "a.md"), root, userHome, [".codex", ".claude"]),
      true,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(userHome, { recursive: true, force: true });
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
