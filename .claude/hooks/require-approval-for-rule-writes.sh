#!/bin/bash
# PreToolUse(Write|Edit|MultiEdit|NotebookEdit|Bash) hook: ルール化の前に必ず利用者へ聞かせる
#
# 目的: エージェントが、直前までの作業の流れを断ち切って、自分の判断で失敗や指摘を
# 恒久ルールにし始めるのを防ぐ。ルール化する・しないを決めるのは利用者である
# (~/.claude/CLAUDE.md の Decision)。文章の規則は実行時に何も止めないので、ここで強制する。
#
# 方式: 恒久ルールのファイルへの書き込みを、利用者の承認が確認できない限り「拒否」で返す。
# 「確認画面(ask)」にしないのが要点である。確認画面で No を押すとターンごと打ち切られ、
# 元の作業へ戻れない。拒否ならターンは続き、下の理由文がエージェントへ届く。理由文は
# 「質問ツールで 2 択を聞き、『しない』なら元の作業を続けよ」と指示する。
#
# 承認の確認方法: セッションログ(入力 JSON の transcript_path)を読み、AskUserQuestion の回答で
#   - 質問の header が「恒久ルール化」で、
#   - 質問文が書き込み先の文字列(拒否の理由文に示したもの。ファイル編集ツールなら絶対パス)を
#     そのまま含み(ファイル名だけだと、プロジェクトの CLAUDE.md への承認でグローバルの
#     CLAUDE.md まで通ってしまう)、
#   - 選ばれた回答が「ルール化する」で始まる
# ものが、人が最後に発言した後(= 同じターンの中)にあれば承認済みとみなして素通しする。
# 同じファイルについて後から「しない」が選ばれていれば、そちらが勝つ。
#
# 対象パス: CLAUDE.md / <設定ルート>/hooks/ / <設定ルート>/rules/ / 自動メモリ
# (<設定ルート>/projects/*/memory/)。設定ルートは .claude と、.claude-bedrock のような別プロファイル。
# 一時ディレクトリ配下は対象外(hook のテストが作る作り物であり、効力のあるルールではない)。
#
# Bash: コマンド文字列の部分一致では判定しない(読み取りを書き込みと誤認し、cat するだけで
# 止まる)。lib/rule-write-detector/detect.py がコマンドを字句解析し、書き込み操作の行き先が
# 対象パスである時だけその行き先を返す。ファイル編集ツールを拒否されたエージェントが Bash へ
# 切り替えて質問を飛ばす経路を塞ぐためのもので、判定の仕様は同ディレクトリの各モジュール冒頭にある。
#
# 既知の限界: Bash の判定は安全網であって封鎖ではない。出所の分からない変数、実行時に組み立てる
# パス、ファイルに保存したスクリプトの実行は検知できない。python3 が無い・判定器が異常終了した時、
# コマンドを字句解析できない時は Bash を素通しする(部分一致へ戻すと読み取りまで止めてしまうため)。
# サブエージェントは質問ツールを使えないので、その書き込みは常に拒否になる。
#
# 出力規約: 対象外・承認済みなら何も出力せず exit 0。未承認なら deny を返す。いかなる場合も exit 0。

APPROVAL_HEADER="恒久ルール化"
APPROVE_PREFIX="ルール化する"

hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
input="$(cat)"

deny() {
  # 引数: 書き込み先の表示名。理由文はエージェントへの指示であり、利用者には見えない
  local target="$1"
  local reason="恒久ルールにあたる ${target} への書き込みは、利用者の承認を確認できないため実行しません。直前まで行っていた作業を中断して、ルール化を始めないでください。別のツールや Bash に切り替えて同じ書き込みを試みないでください。ルール化が必要だと考えるなら、AskUserQuestion で利用者に聞いてください: header は「${APPROVAL_HEADER}」、質問文には書き込み先「${target}」をこの文字列のまま含め、入れる文面もそのまま示し、選択肢は「${APPROVE_PREFIX}」と「しない(元の作業へ戻る)」の 2 つにします。「${APPROVE_PREFIX}」が選ばれたら、同じターンの中でもう一度書き込んでください(Bash で書く時は、書き込み先を変数に入れずパスのまま書くこと)。「しない」が選ばれたら、ルール化はせず、直前まで行っていた作業をそのまま続けてください。利用者が自分からルール化を指示した場合も、同じ質問で文面と書き込み先を確認してから書きます。"
  if command -v jq >/dev/null 2>&1; then
    jq -n --arg reason "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
  else
    # jq が無い時は理由文を固定の JSON で返す(引用符を含まない文だけを使う)
    printf '%s\n' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"恒久ルールのファイルへの書き込みですが、jq が見つからず利用者の承認を確認できないため実行しません。jq を入れてください。ルール化はせず、直前まで行っていた作業を続けてください。"}}'
  fi
  exit 0
}

# 恒久ルールを構成するパスか判定する(ファイル編集ツールの書き込み先に対して)
is_rule_path() {
  local path="$1"
  case "$path" in
    /tmp/*|/private/tmp/*|/var/folders/*|/private/var/folders/*) return 1 ;;
  esac
  [[ "$path" =~ (^|/)CLAUDE\.md$ ]] && return 0
  [[ "$path" =~ (^|/)\.claude[^/]*/(hooks|rules)/ ]] && return 0
  [[ "$path" =~ (^|/)\.claude[^/]*/projects/[^/]+/memory/ ]] && return 0
  return 1
}

# python3 の場所を返す。GUI や IDE から起動されると PATH に mise の python が無いことがある
find_python() {
  local found
  found="$(command -v python3 2>/dev/null)"
  if [ -z "$found" ] && command -v mise >/dev/null 2>&1; then
    found="$(mise which python3 2>/dev/null)"
  fi
  [ -n "$found" ] && [ -x "$found" ] && printf '%s' "$found"
}

# Bash コマンドが書き込む恒久ルールのパスを返す。書き込まない・判定できない時は何も返さない
bash_write_target() {
  local command_text="$1" python detector
  detector="$hook_dir/lib/rule-write-detector/detect.py"
  python="$(find_python)"
  [ -n "$python" ] && [ -f "$detector" ] || return 0
  printf '%s' "$command_text" | "$python" -B "$detector" 2>/dev/null || return 0
}

# jq が無いと入力 JSON を読めない。関門が黙って消えないよう、恒久ルールのパスらしき文字列を
# 含むファイル編集だけを拒否する(無関係な編集や Bash の読み取りまで止めて作業不能にはしない)
if ! command -v jq >/dev/null 2>&1; then
  case "$input" in
    *'"tool_name":"Bash"'*|*'"tool_name": "Bash"'*) exit 0 ;;
  esac
  case "$input" in
    *CLAUDE.md*|*.claude*/hooks/*|*.claude*/rules/*|*.claude*/memory/*) deny "(jq が無いため対象を特定できません)" ;;
  esac
  exit 0
fi

tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"
case "$tool_name" in
  Write|Edit|MultiEdit|NotebookEdit)
    target="$(printf '%s' "$input" | jq -r '.tool_input.file_path // .tool_input.notebook_path // empty')"
    [ -n "$target" ] || exit 0
    is_rule_path "$target" || exit 0
    ;;
  Bash)
    command_text="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"
    [ -n "$command_text" ] || exit 0
    target="$(bash_write_target "$command_text")"
    [ -n "$target" ] || exit 0
    ;;
  *)
    exit 0
    ;;
esac

transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"
[ -n "$transcript_path" ] && [ -r "$transcript_path" ] || deny "$target"

# セッションログを先頭から順に読み、このファイルについての承認の状態を最後まで追う。
#   人が打った発言     → 承認を失効させる(承認はターンをまたがない)
#   対象の質問への回答 → 「ルール化する」で始まれば承認、それ以外なら不承認
# 行ごとに読んで壊れた行は飛ばす(書き込み途中の最終行で判定全体を失敗させないため)
approved="$(jq -n -r -R \
  --arg header "$APPROVAL_HEADER" --arg approve "$APPROVE_PREFIX" --arg target "$target" '
  reduce (inputs | fromjson? | select(type == "object" and .type == "user" and (.isSidechain != true))) as $entry (false;
    if ($entry.toolUseResult | type) == "object" and ($entry.toolUseResult | has("questions")) then
      reduce ($entry.toolUseResult.questions[]
              | select(.header == $header and (.question | contains($target)))) as $q (.;
        (($entry.toolUseResult.answers // {})[$q.question] // "") | startswith($approve))
    elif ($entry | has("toolUseResult")) or ($entry.isMeta == true) then .
    else false
    end)
' "$transcript_path" 2>/dev/null)"

[ "$approved" = "true" ] && exit 0
deny "$target"
