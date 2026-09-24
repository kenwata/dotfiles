import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../cli.mjs", import.meta.url));
const roots = [];

after(() => roots.forEach((root) => rmSync(root, { recursive: true, force: true })));

const GLUED = ["function f(x) {", "  if (x) {", "    run(x);", "  }", "  finish();", "}", ""]
  .join("\n");

// 規約を配布済みのプロジェクト(coding-principles.md あり)か、未配布のプロジェクトを作る
function makeProject({ withRules }) {
  const root = mkdtempSync(join(tmpdir(), "code-layout-"));

  roots.push(root);

  if (withRules) {
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, ".claude", "rules", "coding-principles.md"), "# Coding Principles\n");
  }

  return root;
}

function run(root, relativePath, source, toolInput = {}) {
  const filePath = join(root, relativePath);

  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, source);

  const toolName = "new_string" in toolInput ? "Edit" : "Write";
  const toolInputWithPath = { file_path: filePath, ...toolInput };
  const input = JSON.stringify({ tool_name: toolName, tool_input: toolInputWithPath });

  return spawnSync(process.execPath, [cli, filePath, root], { input, encoding: "utf8" });
}

test("規約を配布済みのプロジェクトで指摘があれば exit 2 と stderr の一覧", () => {
  const root = makeProject({ withRules: true });

  const result = run(root, "src/a.ts", GLUED);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /coding-principles\.md §14/);
  assert.match(result.stderr, /L4-5: statement glued to the block closed on L4/);
});

test("指摘が無ければ何も出さず exit 0", () => {
  const root = makeProject({ withRules: true });

  const result = run(root, "src/a.ts", "run();\n");

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("coding-principles.md が無いプロジェクトでは何もしない", () => {
  const root = makeProject({ withRules: false });

  const result = run(root, "src/a.ts", GLUED);

  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
});

test("対象外の拡張子と、依存・生成物のディレクトリは何もしない", () => {
  const root = makeProject({ withRules: true });

  assert.equal(run(root, "README.md", GLUED).status, 0);
  assert.equal(run(root, "node_modules/x/a.ts", GLUED).status, 0);
  assert.equal(run(root, "src/fixtures/data.ts", GLUED).status, 0);
});

test("Edit では今回編集した行に関わる指摘だけを返す", () => {
  const root = makeProject({ withRules: true });
  const source = `${GLUED}\nconst untouched = 1;\n`;

  const outside = run(root, "src/a.ts", source, { new_string: "const untouched = 1;" });
  const inside = run(root, "src/a.ts", source, { new_string: "  finish();" });

  assert.equal(outside.status, 0);
  assert.equal(inside.status, 2);
});

test("プロジェクトの外のファイルは何もしない", () => {
  const root = makeProject({ withRules: true });
  const other = makeProject({ withRules: false });
  const filePath = join(other, "a.ts");

  writeFileSync(filePath, GLUED);

  const input = JSON.stringify({ tool_name: "Write", tool_input: { file_path: filePath } });
  const result = spawnSync(process.execPath, [cli, filePath, root], { input, encoding: "utf8" });

  assert.equal(result.status, 0);
});

test("--rules-dir で規約の置き場を指定できる(Codex のプロジェクトは .codex/rules)", () => {
  const root = makeProject({ withRules: false });
  const filePath = join(root, "src", "a.ts");

  mkdirSync(join(root, ".codex", "rules"), { recursive: true });
  writeFileSync(join(root, ".codex", "rules", "coding-principles.md"), "# Coding Principles\n");
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(filePath, GLUED);

  const args = [cli, filePath, root];
  const codexArgs = [...args, "--rules-dir=.codex", "--rules-dir=.claude"];
  const withCodex = spawnSync(process.execPath, codexArgs, { input: "", encoding: "utf8" });
  const claudeOnly = spawnSync(process.execPath, args, { input: "", encoding: "utf8" });

  assert.equal(withCodex.status, 2);
  assert.equal(claudeOnly.status, 0);
});

test("削除だけの Edit(new_string が空)は、位置を特定できないので何も返さない", () => {
  const root = makeProject({ withRules: true });

  const result = run(root, "src/a.ts", GLUED, { new_string: "", old_string: "removed();\n" });

  assert.equal(result.status, 0);
});
