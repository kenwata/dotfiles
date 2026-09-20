#!/bin/bash
# require-approval-for-rule-writes.sh の振る舞いテスト。
# 実行: bash ~/.claude/hooks/tests/test-require-approval-for-rule-writes.sh
# permissionDecision が "deny" = 書き込みを止めてエージェントに質問させる、"none" = 素通し。
# "ask"(確認画面)を返してはならない: 確認画面で No を押すとターンが打ち切られ、元の作業へ戻れない。

hook="$(cd "$(dirname "$0")/.." && pwd)/require-approval-for-rule-writes.sh"
work="$(mktemp -d)"
trap 'command rm -rf "$work"' EXIT
failures=0
HOME_DIR="/Users/someone"

# 引数: テスト名 / 期待する判定(deny または none) / 入力 JSON
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

# セッションログの 1 行を作る部品
human_says() { jq -nc --arg t "$1" '{type:"user", message:{role:"user", content:$t}}'; }
meta_note() { jq -nc --arg t "$1" '{type:"user", isMeta:true, message:{role:"user", content:$t}}'; }
tool_ran() { jq -nc '{type:"user", toolUseResult:{stdout:"ok"}, message:{role:"user", content:[{type:"tool_result", content:"ok"}]}}'; }
tool_rejected() { jq -nc '{type:"user", toolUseResult:"User rejected tool use", message:{role:"user", content:[{type:"tool_result", content:"rejected"}]}}'; }
# 引数: header / 質問文 / 選ばれた回答
answered() {
  jq -nc --arg h "$1" --arg q "$2" --arg a "$3" \
    '{type:"user", toolUseResult:{questions:[{header:$h, question:$q, options:[]}], answers:{($q):$a}, annotations:{}}, message:{role:"user", content:[{type:"tool_result", content:"answered"}]}}'
}

# 引数: ツール名 / 書き込み先 / セッションログのパス(省略可)
edit_input() {
  jq -nc --arg tool "$1" --arg path "$2" --arg log "${3:-}" \
    '{tool_name:$tool, tool_input:{file_path:$path}} + (if $log == "" then {} else {transcript_path:$log} end)'
}

Q_CLAUDE="$HOME_DIR/repo/CLAUDE.md の Rules に次の 1 行を足します: 「…」。恒久ルールにしますか"
Q_SHELL="$HOME_DIR/repo/.claude/rules/shell.md に次を足します: 「…」。恒久ルールにしますか"
Q_BASH="Bash で CLAUDE.md に次の 1 行を追記します: 「…」。恒久ルールにしますか"

# --- 承認が無ければ、恒久ルールへの書き込みはすべて拒否してエージェントに質問させる
log="$work/no-approval.jsonl"
{ human_says "この不具合を直して"; tool_ran; } > "$log"
run_case "未承認: グローバル CLAUDE.md"    deny "$(edit_input Write "$HOME_DIR/.claude/CLAUDE.md" "$log")"
run_case "未承認: プロジェクトの CLAUDE.md" deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"
run_case "未承認: hook スクリプトの Edit"   deny "$(edit_input Edit "$HOME_DIR/.claude/hooks/check-stop-question.sh" "$log")"
run_case "未承認: 自動メモリ"              deny "$(edit_input Write "$HOME_DIR/.claude/projects/x/memory/foo.md" "$log")"
run_case "未承認: .claude/rules 配下"      deny "$(edit_input Write "$HOME_DIR/repo/.claude/rules/lua.md" "$log")"
run_case "未承認: 別プロファイルのメモリ"   deny "$(edit_input Write "$HOME_DIR/.claude-bedrock/projects/x/memory/foo.md" "$log")"
run_case "未承認: MultiEdit も対象"        deny "$(edit_input MultiEdit "$HOME_DIR/repo/CLAUDE.md" "$log")"
run_case "セッションログが渡されない"       deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md")"
run_case "セッションログが読めない"         deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$work/missing.jsonl")"

# --- 確認画面(ask)を返さないこと。返すと No でターンが打ち切られ、目的に反する
decision="$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log" | bash "$hook" | jq -r '.hookSpecificOutput.permissionDecision')"
if [ "$decision" = "ask" ]; then echo "FAIL ask を返している"; failures=$((failures + 1)); else echo "ok   ask ではなく deny を返す"; fi
reason="$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log" | bash "$hook" | jq -r '.hookSpecificOutput.permissionDecisionReason')"
case "$reason" in
  *AskUserQuestion*"恒久ルール化"*"元の作業"*) echo "ok   理由文が質問の仕方と「しないなら元の作業へ戻る」を指示する" ;;
  *) echo "FAIL 理由文に指示が足りない: $reason"; failures=$((failures + 1)) ;;
esac

# --- 同じターンの中で、そのファイルについて「ルール化する」が選ばれていれば通す
log="$work/approved.jsonl"
{ human_says "この不具合を直して"; tool_ran; answered "恒久ルール化" "$Q_CLAUDE" "ルール化する"; } > "$log"
run_case "承認済み: CLAUDE.md"                none "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"
run_case "承認済み: 続けて 2 回目の編集も通る" none "$(edit_input Edit "$HOME_DIR/repo/CLAUDE.md" "$log")"
run_case "承認は別のファイルに及ばない"        deny "$(edit_input Write "$HOME_DIR/repo/.claude/rules/shell.md" "$log")"
run_case "プロジェクトの承認でグローバルの CLAUDE.md は通らない" deny "$(edit_input Write "$HOME_DIR/.claude/CLAUDE.md" "$log")"

log="$work/approved-with-note.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_SHELL" "ルール化する(推奨)"; tool_ran; meta_note "system note"; tool_rejected; } > "$log"
run_case "承認後のツール実行・拒否・メタ行では失効しない" none "$(edit_input Edit "$HOME_DIR/repo/.claude/rules/shell.md" "$log")"

# --- 「しない」が選ばれたら通さない。後からの回答が勝つ
log="$work/declined.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_CLAUDE" "しない(元の作業へ戻る)"; } > "$log"
run_case "「しない」を選んだ"                 deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

log="$work/approved-then-declined.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_CLAUDE" "ルール化する"; answered "恒久ルール化" "$Q_CLAUDE" "しない(元の作業へ戻る)"; } > "$log"
run_case "承認の後に「しない」"               deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

log="$work/free-text.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_CLAUDE" "文面を変えてほしい"; } > "$log"
run_case "自由記述の回答は承認ではない"        deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

# --- 承認はターンをまたがない。人が次の発言をしたら失効する
log="$work/expired.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_CLAUDE" "ルール化する"; tool_ran; human_says "次はテストを足して"; tool_ran; } > "$log"
run_case "次の発言の後は失効"                 deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

# --- 見出しが違う質問への「はい」を承認に流用させない
log="$work/other-header.jsonl"
{ human_says "直して"; answered "進め方" "$Q_CLAUDE" "ルール化する"; } > "$log"
run_case "header が違う質問は承認ではない"     deny "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

# --- 壊れた行(書き込み途中の最終行)があっても判定できる
log="$work/partial-line.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_CLAUDE" "ルール化する"; printf '{"type":"user","mess'; } > "$log"
run_case "壊れた最終行があっても承認を読める"   none "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")"

# --- ルールと無関係なファイル、読み取り、作り物は素通しする
log="$work/no-approval.jsonl"
run_case "無関係なソース"                     none "$(edit_input Write "$HOME_DIR/repo/src/main.lua" "$log")"
run_case "CLAUDE.md を名前に含む別ファイル"    none "$(edit_input Write "$HOME_DIR/repo/docs/CLAUDE.md.bak" "$log")"
run_case "templates/rules は対象外"           none "$(edit_input Write "$HOME_DIR/.claude/templates/rules/lua.md" "$log")"
run_case "Read は読むだけ"                    none "$(edit_input Read "$HOME_DIR/.claude/CLAUDE.md" "$log")"
run_case "一時ディレクトリの作り物"            none "$(edit_input Write "/private/tmp/x/repo/.claude/rules/lua.md" "$log")"

# 引数: Bash のコマンド / セッションログのパス
bash_input() { jq -nc --arg c "$1" --arg log "$2" '{tool_name:"Bash", tool_input:{command:$c}, transcript_path:$log}'; }

# --- Bash でも、書き込み操作の行き先が恒久ルールなら、承認が無い限り拒否する
# (ファイル編集ツールを拒否されたエージェントが Bash へ切り替えて質問を飛ばす経路を塞ぐ)
log="$work/no-approval.jsonl"
run_case "Bash 未承認: CLAUDE.md へ heredoc"      deny "$(bash_input $'cat >| ~/.claude/CLAUDE.md <<\'EOF\'\n- new rule\nEOF' "$log")"
run_case "Bash 未承認: hook を perl で上書き"     deny "$(bash_input "perl -0pi -e 's/a/b/' ~/.claude/hooks/x.sh" "$log")"
run_case "Bash 未承認: メモリへ cp"               deny "$(bash_input 'command cp -f /tmp/a.md ~/.claude/projects/x/memory/a.md' "$log")"
run_case "Bash 未承認: 変数経由でメモリへ追記"     deny "$(bash_input $'M=~/.claude/projects/x/memory\necho "- a" >> "$M/MEMORY.md"' "$log")"
run_case "Bash 未承認: cd してから sed -i"         deny "$(bash_input "cd ~/.claude/projects/x/memory/ && sed -i '' '7s|.*|- new|' MEMORY.md" "$log")"
run_case "Bash 未承認: Python から write_text"     deny "$(bash_input $'python3 - <<\'PY\'\nfrom pathlib import Path\nPath(".claude/rules/shell.md").write_text("x")\nPY' "$log")"
run_case "Bash 未承認: bash -c の中の書き込み"     deny "$(bash_input "bash -c 'echo x > CLAUDE.md'" "$log")"
run_case "Bash 未承認: git checkout で巻き戻す"    deny "$(bash_input 'git checkout -- .claude/rules/shell.md' "$log")"

# --- Bash の読み取りでは止めない(cat するだけで止まると使い物にならない。旧 hook の誤検知の型)
run_case "Bash 読取: cat + 2>/dev/null"            none "$(bash_input 'cat ~/.claude/CLAUDE.md 2>/dev/null | head -3' "$log")"
run_case "Bash 読取: hooks を grep + 2>&1"         none "$(bash_input 'grep -n "x" .claude/hooks/validate-record.sh 2>&1' "$log")"
run_case "Bash 読取: sed -n"                       none "$(bash_input "sed -n '1,40p' .claude/rules/shell.md" "$log")"
run_case "Bash 読取: 'confirm ' を検索(rm を含む語)" none "$(bash_input "grep -n 'confirm ' CLAUDE.md" "$log")"
run_case "Bash 読取: git add(dd を含む語)"         none "$(bash_input 'git add .claude/rules/shell.md' "$log")"
run_case "Bash 読取: ルールを別の場所へコピー"      none "$(bash_input 'cat .claude/rules/shell.md > /tmp/copy.md' "$log")"
run_case "Bash 読取: コミット文がルールのパスに言及" none "$(bash_input $'git commit -F - <<\'MSG\'\nfix: a -> b\n\n対応: .claude/rules/shell.md を直した <https://x.y>\nMSG' "$log")"
run_case "Bash 読取: Python が読むだけ"            none "$(bash_input $'python3 - <<\'PY\'\nfrom pathlib import Path\nprint(len(Path("CLAUDE.md").read_text()) > 0)\nPY' "$log")"
run_case "Bash 読取: HANDOFF を書き換える文章がルールに言及" none "$(bash_input $'python3 - <<\'PY\'\nfrom pathlib import Path\np = Path("HANDOFF.md")\np.write_text(p.read_text().replace("a", "`.claude/rules/lua.md` の更新は後で"))\nPY' "$log")"
run_case "Bash: 一時ディレクトリの作り物への書き込み" none "$(bash_input $'ROOT="$(mktemp -d)"\nmkdir -p "$ROOT/.claude/rules"\nprintf x > "$ROOT/.claude/rules/markdown.md"' "$log")"
run_case "Bash: 字句解析できないコマンドは素通し"    none "$(bash_input "echo 'unbalanced > CLAUDE.md" "$log")"

# --- Bash でも、承認があれば通す。承認は別のファイルに及ばない
log="$work/approved-bash.jsonl"
{ human_says "直して"; answered "恒久ルール化" "$Q_BASH" "ルール化する"; } > "$log"
run_case "Bash 承認済み: CLAUDE.md へ追記"         none "$(bash_input 'echo "- rule" >> CLAUDE.md' "$log")"
run_case "Bash 承認は別のファイルに及ばない"        deny "$(bash_input 'echo x >> .claude/rules/shell.md' "$log")"

# --- 判定器が無い・落ちる時は Bash を素通しし、ファイル編集ツールの関門は残る
bare="$work/bare-hooks"
mkdir -p "$bare"
command cp "$hook" "$bare/"
log="$work/no-approval.jsonl"
out="$(bash_input 'echo x > CLAUDE.md' "$log" | bash "$bare/require-approval-for-rule-writes.sh")"
if [ -z "$out" ]; then echo "ok   判定器なし: Bash は素通し"; else echo "FAIL 判定器なし: Bash を止めた"; failures=$((failures + 1)); fi
out="$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log" | bash "$bare/require-approval-for-rule-writes.sh" | jq -r '.hookSpecificOutput.permissionDecision // "none"')"
if [ "$out" = "deny" ]; then echo "ok   判定器なし: ファイル編集ツールは拒否のまま"; else echo "FAIL 判定器なし: ファイル編集ツールが通った"; failures=$((failures + 1)); fi
mkdir -p "$bare/lib/rule-write-detector"
printf 'raise SystemExit(1)\n' > "$bare/lib/rule-write-detector/detect.py"
out="$(bash_input 'cat CLAUDE.md 2>/dev/null' "$log" | bash "$bare/require-approval-for-rule-writes.sh")"
if [ -z "$out" ]; then echo "ok   判定器が異常終了: 読み取りを止めない"; else echo "FAIL 判定器が異常終了: 読み取りを止めた"; failures=$((failures + 1)); fi

# --- jq が無くても関門が黙って消えない(無関係な編集は止めない)
nojq="$work/nojq-bin"
mkdir -p "$nojq"
ln -s "$(command -v cat)" "$nojq/cat"
ln -s "$(command -v dirname)" "$nojq/dirname"
run_nojq() { printf '%s' "$1" | PATH="$nojq" /bin/bash "$hook"; }
out="$(run_nojq "$(bash_input 'cat CLAUDE.md' "$log")")"
if [ -z "$out" ]; then echo "ok   jq 無し: Bash の読み取りは止めない"; else echo "FAIL jq 無し: Bash の読み取りを止めた"; failures=$((failures + 1)); fi
out="$(run_nojq "$(edit_input Write "$HOME_DIR/repo/CLAUDE.md" "$log")" | jq -r '.hookSpecificOutput.permissionDecision // "none"')"
if [ "$out" = "deny" ]; then echo "ok   jq 無し: 恒久ルールは拒否"; else echo "FAIL jq 無し: 恒久ルールが通った ($out)"; failures=$((failures + 1)); fi
out="$(run_nojq "$(edit_input Write "$HOME_DIR/repo/src/main.lua" "$log")")"
if [ -z "$out" ]; then echo "ok   jq 無し: 無関係な編集は素通し"; else echo "FAIL jq 無し: 無関係な編集を止めた"; failures=$((failures + 1)); fi

if [ "$failures" -gt 0 ]; then
  echo "$failures case(s) failed"
  exit 1
fi
echo "all passed"
