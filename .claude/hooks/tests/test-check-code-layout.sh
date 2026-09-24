#!/bin/bash
# check-code-layout.sh の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-check-code-layout.sh
# 判定そのもの(どの行を指摘するか)は hooks/lib/code-layout/test/ が検査する。ここでは hook の入口
# (ツール名の絞り込み・CLAUDE_PROJECT_DIR の受け渡し・終了コードと stderr の中継)だけを見る。

hook="$(cd "$(dirname "$0")/.." && pwd)/check-code-layout.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
failures=0

project="$work_dir/project"
mkdir -p "$project/.claude/rules" "$project/src"
printf '# Coding Principles\n' > "$project/.claude/rules/coding-principles.md"
printf 'function f(x) {\n  if (x) {\n    run(x);\n  }\n  finish();\n}\n' > "$project/src/glued.ts"
printf 'run();\n' > "$project/src/clean.ts"

# 引数: テスト名 / 期待する終了コード / stderr に含まれるべき文字列(空なら stderr も空を期待) /
#       ツール名 / 対象ファイル / CLAUDE_PROJECT_DIR(空なら未設定)
run_case() {
  local name="$1" expected_code="$2" expected="$3" tool="$4" file="$5" root="$6"
  local input stderr actual_code
  input="$(jq -n --arg tool "$tool" --arg file "$file" \
    '{tool_name: $tool, tool_input: {file_path: $file}}')"

  if [ -n "$root" ]; then
    stderr="$(printf '%s' "$input" | CLAUDE_PROJECT_DIR="$root" bash "$hook" 2>&1 >/dev/null)"
  else
    stderr="$(printf '%s' "$input" | env -u CLAUDE_PROJECT_DIR bash "$hook" 2>&1 >/dev/null)"
  fi

  actual_code=$?

  if [ "$actual_code" -ne "$expected_code" ]; then
    echo "FAIL $name: exit=$actual_code expected=$expected_code"; failures=$((failures + 1)); return
  fi
  if [ -z "$expected" ] && [ -n "$stderr" ]; then
    echo "FAIL $name: stderr should be empty but was: $stderr"; failures=$((failures + 1)); return
  fi
  if [ -n "$expected" ] && ! printf '%s' "$stderr" | grep -q "$expected"; then
    echo "FAIL $name: stderr lacks '$expected' (was: $stderr)"; failures=$((failures + 1)); return
  fi

  echo "ok   $name"
}

glued="$project/src/glued.ts"
run_case "write_glued_reports" 2 "statement glued to the block" Write "$glued" "$project"
run_case "edit_glued_reports" 2 "coding-principles.md §14" Edit "$project/src/glued.ts" "$project"
run_case "clean_file_silent" 0 "" Write "$project/src/clean.ts" "$project"
run_case "other_tool_ignored" 0 "" Read "$project/src/glued.ts" "$project"
run_case "no_project_dir_silent" 0 "" Write "$project/src/glued.ts" ""

if [ "$failures" -gt 0 ]; then
  echo "$failures failure(s)"
  exit 1
fi

echo "all passed"
