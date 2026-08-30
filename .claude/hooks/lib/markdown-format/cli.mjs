#!/usr/bin/env node
import { readFileSync, writeFileSync } from "node:fs";
import { formatMarkdown } from "./format.mjs";
import { lintMarkdown } from "./lint.mjs";
import { shouldFormat } from "./gate.mjs";
import { editedLineRanges } from "./scope.mjs";

// 呼び出し規約(hooks/format-markdown.sh から呼ばれる):
//   node cli.mjs <対象ファイルの絶対パス> [プロジェクトルートの絶対パス] [--rules-dir=<dir>]...
//   stdin: PostToolUse hook の入力 JSON(省略可)
// --rules-dir は繰り返し指定可。無指定なら既定 [".claude"](Claude Code 本来の判定基準)。
// Codex アダプター(.codex/hooks/format-markdown.mjs)のみが自身の spawnSync 呼び出しで
// `--rules-dir=.codex --rules-dir=.claude` を明示指定する。Claude Code からの通常呼び出し
// (hooks/format-markdown.sh)はこのフラグを渡さないため既定のまま。
// 出力規約:
//   - .md 以外、または対象ファイルがいずれの rules/markdown.md の paths: にもマッチしない
//     場合は何も出力せず exit 0(no-op)。
//   - formatter が書き換えた場合と linter が検出した場合: stderr に内容を出力して exit 2
//     (PostToolUse hook の exit 2 は stderr が Claude に見える、と文書化されている
//     唯一の確実な経路のため、これに一本化する)。
//   - どちらも無ければ何も出力せず exit 0。
//
// 適用範囲(scope.mjs): stdin から Edit(部分編集ツール)の入力 JSON が渡され、
// tool_input.new_string が非空の場合のみ「今回編集した行」に整形・lint を限定する
// (未編集の既存箇所への波及を防ぐ)。stdin 無し・JSON でない・Write・new_string 空の
// 場合は従来どおりファイル全体が対象(CLI 直接実行・/markdown-cleanup 経由も同様)。
// new_string がファイル内に見つからない場合は、スコープを安全に決定できないため
// 全体扱いにはせずフェイルオープンで何もしない。
function readStdinJson() {
  if (process.stdin.isTTY) return null;
  let raw;
  try {
    raw = readFileSync(0, "utf8");
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

// --rules-dir=<dir> を除いた残りを位置引数として返す。`ruleDirs` は undefined
// (フラグ無し、gate.mjs の既定を使う)または指定順を保った配列。
function parseArgs(argv) {
  const positional = [];
  const ruleDirs = [];
  for (const arg of argv) {
    const m = arg.match(/^--rules-dir=(.+)$/);
    if (m) ruleDirs.push(m[1]);
    else positional.push(arg);
  }
  return { positional, ruleDirs: ruleDirs.length > 0 ? ruleDirs : undefined };
}

function main() {
  const { positional, ruleDirs } = parseArgs(process.argv.slice(2));
  const [filePath, projectRoot] = positional;

  if (!filePath || !filePath.endsWith(".md")) {
    process.exit(0);
  }

  if (!shouldFormat(filePath, projectRoot ?? "", undefined, ruleDirs)) {
    process.exit(0);
  }

  let original;
  try {
    original = readFileSync(filePath, "utf8");
  } catch {
    process.exit(0);
  }

  let lineRanges;
  const input = readStdinJson();
  if (input?.tool_name === "Edit" && input.tool_input?.new_string) {
    const ranges = editedLineRanges(original, input.tool_input.new_string);
    if (ranges.size === 0) {
      process.exit(0);
    }
    lineRanges = ranges;
  }

  const formatResult = formatMarkdown(original, { lineRanges });
  const { text, changed } = formatResult;
  if (changed) {
    writeFileSync(filePath, text, "utf8");
  }

  // formatMarkdown が空行を挿入すると、それより後ろの行の行インデックスがずれる。
  // lint は整形後の text に対して走るため、元の lineRanges ではなく
  // formatMarkdown が返す補正済みの lineRanges を使う(scope.mjs 参照)。
  const findings = lintMarkdown(text, { lineRanges: formatResult.lineRanges });

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
