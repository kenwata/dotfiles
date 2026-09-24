#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { editedLineRanges } from "../markdown-format/scope.mjs";
import { languageFor } from "./languages.mjs";
import { findLayoutIssues } from "./layout.mjs";

// 呼び出し規約(hooks/check-code-layout.sh から呼ばれる):
//   node cli.mjs <対象ファイルの絶対パス> <プロジェクトルートの絶対パス> [--rules-dir=<dir>]...
//   stdin: PostToolUse hook の入力 JSON(省略可)
// --rules-dir は規約を探すディレクトリで、繰り返し指定できる。無指定なら [".claude"]。
// Codex のアダプター(.codex/hooks/check-code-layout.mjs)だけが
// `--rules-dir=.codex --rules-dir=.claude` を渡す(markdown-format の cli.mjs と同じ取り決め)
// 出力規約:
//   - 指摘があれば stderr に一覧を出して exit 2(PostToolUse hook で Claude に見える唯一の確実な
//     経路。hooks/format-markdown.sh と同じ)。ファイルは書き換えない。どこで段落を切るかは
//     Claude に判断させるため
//   - 対象外・指摘なし・異常時は何も出さず exit 0(フェイルオープン)
//
// 対象: プロジェクトが <rules-dir>/rules/coding-principles.md を持つ時だけ動く。
// 規約を配布していないリポジトリ(他人のコード)で指摘を出さないため。
// 依存・生成物・テストデータのディレクトリは除く。Edit(部分編集)では、new_string の行に触れる
// 指摘だけを返す(未編集の既存箇所を責めない)。

// 指摘をこの件数まで表示し、残りは件数だけ伝える
const MAX_REPORTED = 15;

// 依存・生成物・テストデータのディレクトリ。人が段落を組むコードではない
const SKIPPED_DIRECTORIES = [
  "node_modules",
  "vendor",
  "dist",
  "build",
  "target",
  ".venv",
  "venv",
  "__pycache__",
  "fixtures",
  "__snapshots__",
  ".git",
];
const SKIPPED_DIRECTORY = new RegExp(
  `(^|/)(${SKIPPED_DIRECTORIES.map((name) => name.replace(".", "\\.")).join("|")})/`,
);

const DEFAULT_RULES_DIRS = [".claude"];
const RULES_DIR_FLAG = "--rules-dir=";

function main(argv) {
  const [filePath, projectRoot] = argv.filter((arg) => !arg.startsWith(RULES_DIR_FLAG));
  const flagged = argv
    .filter((arg) => arg.startsWith(RULES_DIR_FLAG))
    .map((arg) => arg.slice(RULES_DIR_FLAG.length));
  const rulesDirs = flagged.length > 0 ? flagged : DEFAULT_RULES_DIRS;

  if (!filePath || !projectRoot) return 0;

  const language = languageFor(filePath);
  const relativePath = relative(projectRoot, filePath).split(sep).join("/");

  const outOfScope = relativePath.startsWith("..") || SKIPPED_DIRECTORY.test(relativePath);

  if (language === null || outOfScope) return 0;
  const hasRules = rulesDirs.some((dir) =>
    existsSync(join(projectRoot, dir, "rules", "coding-principles.md")),
  );

  if (!hasRules) return 0;

  const source = readFileSync(filePath, "utf8");
  const edit = readEdit();

  if (edit.deletionOnly) return 0;

  const issues = inScope(findLayoutIssues(source, language), source, edit.newString);

  if (issues.length === 0) return 0;

  process.stderr.write(report(relativePath, issues));

  return 2;
}

// stdin の hook 入力から Edit の範囲を読む。
// newString: Edit の置換後テキスト。Write・入力なし・読めない時は null(ファイル全体が対象)。
// deletionOnly: new_string が空の Edit。削除した位置は保存後のファイルから特定できないので、
// 何も返さない(全体を対象にすると、編集していない既存箇所の指摘が削除のたびに出る)
function readEdit() {
  try {
    const input = JSON.parse(readFileSync(0, "utf8"));
    const newString = input?.tool_input?.new_string;

    if (input?.tool_name !== "Edit" || typeof newString !== "string") {
      return { newString: null, deletionOnly: false };
    }

    return { newString: newString === "" ? null : newString, deletionOnly: newString === "" };
  } catch {
    return { newString: null, deletionOnly: false };
  }
}

function inScope(issues, source, newString) {
  if (newString === null) return issues;

  const edited = editedLineRanges(source, newString);

  return issues.filter(({ startLine, endLine }) => {
    for (let line = startLine; line <= endLine; line++) {
      if (edited.has(line - 1)) return true;
    }

    return false;
  });
}

function report(relativePath, issues) {
  const shown = issues.slice(0, MAX_REPORTED).map(({ startLine, endLine, message }) => {
    const range = startLine === endLine ? `L${startLine}` : `L${startLine}-${endLine}`;

    return `- ${range}: ${message}`;
  });

  const rest = issues.length - shown.length;

  return [
    `check-code-layout: ${relativePath} breaks the layout floor of coding-principles.md §14:`,
    ...shown,
    ...(rest > 0 ? [`- and ${rest} more`] : []),
    "Fix by choosing where the steps really change, not by inserting blank lines at fixed intervals.",
    "",
  ].join("\n");
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch {
  process.exitCode = 0;
}
