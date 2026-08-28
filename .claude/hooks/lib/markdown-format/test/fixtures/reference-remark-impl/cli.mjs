#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { formatMarkdown } from "./format.mjs";
import { lintMarkdown } from "./lint.mjs";
import { shouldFormat } from "./gate.mjs";

// 呼び出し規約(hooks/format-markdown.sh から呼ばれる):
//   node cli.mjs <対象ファイルの絶対パス> [プロジェクトルートの絶対パス]
// 出力規約:
//   - .md 以外、または対象ファイルが .claude/rules/markdown.md の paths: にマッチしない
//     場合は何も出力せず exit 0(no-op)。
//   - formatter が書き換えた場合: stdout に `formatted:<fixCount>` を1行出力。
//   - linter が検出した場合: stderr に検出内容を出力して exit 2
//     (PostToolUse hook の exit 2 は stderr が Claude に見える、と文書化されている
//     唯一の確実な経路のため、これに一本化する)。
//   - どちらも無ければ何も出力せず exit 0。
function main() {
  const [, , filePath, projectRoot] = process.argv;

  if (!filePath || !filePath.endsWith(".md")) {
    process.exit(0);
  }

  if (!shouldFormat(filePath, projectRoot ?? "")) {
    process.exit(0);
  }

  let original;
  try {
    original = readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  const { text, changed } = formatMarkdown(original);
  if (changed) {
    writeFileSync(filePath, text, "utf8");
  }

  const findings = lintMarkdown(text);

  const messages = [];
  if (changed) {
    messages.push(
      `markdown formatter が ${filePath} の装飾スペース・code fence を自動整形した。このファイルへの次の編集の前に再度 Read すること(ディスク上の内容が変わっている)。`,
    );
  }
  if (findings.length > 0) {
    const lines = findings.map((f) => `  - L${f.line} [${f.rule}] ${f.message}`);
    messages.push(
      `markdown linter が ${filePath} で ${findings.length} 件検出した(自動修正していない。内容を確認し必要なら手で直すこと):\n${lines.join("\n")}`,
    );
  }

  if (messages.length > 0) {
    process.stderr.write(messages.join("\n\n") + "\n");
    process.exit(2);
  }

  process.exit(0);
}

main();
