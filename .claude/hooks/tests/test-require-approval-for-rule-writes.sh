#!/bin/bash
# require-approval-for-rule-writes.sh の振る舞いテスト。
# 実行: bash ~/.claude/hooks/tests/test-require-approval-for-rule-writes.sh
# permissionDecision が "ask" = ユーザーに許可を求める、"none" = 素通し。

hook="$(cd "$(dirname "$0")/.." && pwd)/require-approval-for-rule-writes.sh"
failures=0

# 引数: テスト名 / 期待する判定(ask または none) / 入力 JSON
run_case() {
  local name="$1" expected="$2" input="$3"
  local actual
  actual="$(printf '%s' "$input" | bash "$hook" | jq -r '.hookSpecificOutput.permissionDecision // "none"' 2>/dev/null)"
  [ -n "$actual" ] || actual="none"

  if [ "$actual" = "$expected" ]; then
    echo "ok   $name"
  else
    echo "FAIL $name: decision=$actual expected=$expected"
    failures=$((failures + 1))
  fi
}

write_input() { printf '{"tool_name":"%s","tool_input":{"file_path":"%s"}}' "$1" "$2"; }
bash_input() { jq -nc --arg c "$1" '{tool_name:"Bash", tool_input:{command:$c}}'; }

# 恒久ルールを構成するパスへの直接の書き込みは、すべて承認を要求する
run_case "Write: グローバル CLAUDE.md"   ask  "$(write_input Write "$HOME/.claude/CLAUDE.md")"
run_case "Write: プロジェクトの CLAUDE.md" ask "$(write_input Write "/tmp/repo/CLAUDE.md")"
run_case "Edit: hook スクリプト"         ask  "$(write_input Edit "$HOME/.claude/hooks/check-stop-question.sh")"
run_case "Write: 自動メモリ"             ask  "$(write_input Write "$HOME/.claude/projects/x/memory/foo.md")"
run_case "Write: .claude/rules 配下"     ask  "$(write_input Write "/tmp/repo/.claude/rules/lua.md")"

# ルールと無関係なファイルや、読み取りだけの操作は素通しする
run_case "Write: 無関係なソース"         none "$(write_input Write "/tmp/repo/src/main.lua")"
run_case "Read: CLAUDE.md は読むだけ"     none "$(write_input Read "$HOME/.claude/CLAUDE.md")"

# Bash 経由でも、書き込みを伴う形なら承認を要求する
run_case "Bash: CLAUDE.md へリダイレクト" ask  "$(bash_input 'cat >| ~/.claude/CLAUDE.md <<EOF')"
run_case "Bash: hook を perl で上書き"    ask  "$(bash_input 'perl -0pi -e s/a/b/ ~/.claude/hooks/x.sh')"
run_case "Bash: メモリへ cp"             ask  "$(bash_input 'cp /tmp/a.md ~/.claude/projects/x/memory/a.md')"

# Bash でも読み取りだけなら素通しする(毎回プロンプトが出ると使い物にならないため)
run_case "Bash: CLAUDE.md を grep"       none "$(bash_input 'grep -n rule ~/.claude/CLAUDE.md')"
run_case "Bash: CLAUDE.md を cat"        none "$(bash_input 'cat ~/.claude/CLAUDE.md')"
run_case "Bash: 無関係な書き込み"         none "$(bash_input 'echo hi > /tmp/a.txt')"

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all passed"
