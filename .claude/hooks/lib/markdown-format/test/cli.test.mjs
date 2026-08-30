import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// cli.mjs の e2e(実プロセス起動): PostToolUse hook が渡す stdin JSON によって
// スコープモード(Edit の編集行のみ)と全体モード(Write・stdin 無し)が
// 正しく切り分けられることを確認する。gate(shouldFormat)を通すため、
// 対象ファイルは常に `.claude/rules/markdown.md`(paths: 全 .md)を持つ
// 一時プロジェクト配下に置く。
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// gate はユーザーレベル `~/<rules-dir>/rules/markdown.md` も見るため、実行マシンの
// 実ホームに rules があるかで結果が変わってしまう(特に「no-op のはず」の負のテストが
// 偽陽性で落ちる)。子プロセスの HOME を常に空のダミーへ差し替えて決定的にする
// (gate.test.mjs の NO_USER_RULE_HOME と同じ意図。os.homedir() は HOME を参照する)。
const NO_USER_RULE_HOME = mkdtempSync(join(tmpdir(), "markdown-format-cli-no-user-rule-"));

function makeProject() {
  const root = mkdtempSync(join(tmpdir(), "markdown-format-cli-"));
  mkdirSync(join(root, ".claude", "rules"), { recursive: true });
  writeFileSync(
    join(root, ".claude", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  return root;
}

function runCli(filePath, projectRoot, stdinInput, extraArgs = []) {
  const args = [cliPath, filePath, projectRoot, ...extraArgs];
  const opts = {
    encoding: "utf8",
    env: { ...process.env, HOME: NO_USER_RULE_HOME },
  };
  if (stdinInput !== undefined) {
    opts.input = stdinInput;
  } else {
    opts.stdio = ["ignore", "pipe", "pipe"];
  }
  return spawnSync(process.execPath, args, opts);
}

function makeCodexProject() {
  const root = mkdtempSync(join(tmpdir(), "markdown-format-cli-codex-"));
  mkdirSync(join(root, ".codex", "rules"), { recursive: true });
  writeFileSync(
    join(root, ".codex", "rules", "markdown.md"),
    ["---", "paths:", '  - "**/*.md"', "---", "", "# rule"].join("\n"),
    "utf8",
  );
  return root;
}

test("stdin なし(CLI 直接実行)はファイル全体を対象にする", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    writeFileSync(target, "日本語**A**日本語\n日本語**B**日本語\n", "utf8");
    const result = runCli(target, root);
    assert.equal(result.status, 2);
    assert.equal(
      readFileSync(target, "utf8"),
      "日本語 **A** 日本語\n日本語 **B** 日本語\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Write の PostToolUse JSON はファイル全体を対象にする", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    const content = "日本語**A**日本語\n日本語**B**日本語\n";
    writeFileSync(target, content, "utf8");
    const input = JSON.stringify({
      tool_name: "Write",
      tool_input: { file_path: target, content },
    });
    const result = runCli(target, root, input);
    assert.equal(result.status, 2);
    assert.equal(
      readFileSync(target, "utf8"),
      "日本語 **A** 日本語\n日本語 **B** 日本語\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Edit の PostToolUse JSON は new_string の出現行だけを対象にする(未編集行は不変)", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    // 1 行目は「未編集の既存箇所」の想定(逐語引用相当)。2 行目だけを Edit した体で渡す。
    const content = "日本語**A**日本語\n日本語**B**日本語\n";
    writeFileSync(target, content, "utf8");
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: {
        file_path: target,
        old_string: "日本語**B**日本語",
        new_string: "日本語**B**日本語",
      },
    });
    const result = runCli(target, root, input);
    assert.equal(result.status, 2);
    assert.equal(
      readFileSync(target, "utf8"),
      "日本語**A**日本語\n日本語 **B** 日本語\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Edit の new_string がファイル内に見つからない場合は何もしない(フェイルオープン)", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    const content = "日本語**A**日本語\n";
    writeFileSync(target, content, "utf8");
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: target, old_string: "x", new_string: "見つからない文字列" },
    });
    const result = runCli(target, root, input);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(readFileSync(target, "utf8"), content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("空行挿入で lint 対象行がずれても、編集行の finding は脱落しない(diff-reviewer の指摘、2026-08-28)", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    // new_string が fence(前後に空行挿入が起きる)を含み、続く行に残留装飾記号がある。
    const content = "前文\n```js\ncode\n```\n語**「あ」**語\n";
    writeFileSync(target, content, "utf8");
    const newString = "前文\n```js\ncode\n```\n語**「あ」**語";
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: target, old_string: newString, new_string: newString },
    });
    const result = runCli(target, root, input);
    assert.equal(result.status, 2);
    assert.equal(
      readFileSync(target, "utf8"),
      "前文\n\n````js\ncode\n````\n\n語**「あ」**語\n",
    );
    assert.match(result.stderr, /possible-unrendered-bold/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Edit の new_string が空なら全体を対象にする", () => {
  const root = makeProject();
  try {
    const target = join(root, "a.md");
    const content = "日本語**A**日本語\n";
    writeFileSync(target, content, "utf8");
    const input = JSON.stringify({
      tool_name: "Edit",
      tool_input: { file_path: target, old_string: "", new_string: "" },
    });
    const result = runCli(target, root, input);
    assert.equal(result.status, 2);
    assert.equal(readFileSync(target, "utf8"), "日本語 **A** 日本語\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Claude Code の実呼び出し(hooks/format-markdown.sh)はフラグ無しで cli.mjs を起動する。
// .codex/rules/markdown.md しかないプロジェクトでは、この既定呼び出しは no-op のままで
// なければならない(2026-08-30 の回帰: Codex 移植で shouldFormat が .codex を自動参照する
// ようになっていたのを --rules-dir によるオプトインに戻した)。
test("--rules-dir 未指定では .codex/rules/markdown.md のみのプロジェクトは no-op", () => {
  const root = makeCodexProject();
  try {
    const target = join(root, "a.md");
    const content = "日本語**A**日本語\n";
    writeFileSync(target, content, "utf8");
    const result = runCli(target, root);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.equal(readFileSync(target, "utf8"), content);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// Codex アダプター(.codex/hooks/format-markdown.mjs)が実際に渡す
// --rules-dir=.codex --rules-dir=.claude を指定した場合のみ、.codex/rules/markdown.md を
// 根拠に整形してよい。
test("--rules-dir=.codex を明示指定すると .codex/rules/markdown.md のみのプロジェクトでも整形する", () => {
  const root = makeCodexProject();
  try {
    const target = join(root, "a.md");
    writeFileSync(target, "日本語**A**日本語\n", "utf8");
    const result = runCli(target, root, undefined, ["--rules-dir=.codex", "--rules-dir=.claude"]);
    assert.equal(result.status, 2);
    assert.equal(readFileSync(target, "utf8"), "日本語 **A** 日本語\n");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
