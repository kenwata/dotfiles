#!/bin/bash
# PreToolUse(Write|Edit|MultiEdit|Bash) hook: 恒久ルールへの書き込みに承認を必須にする
#
# CLAUDE.md の Decision は「ユーザーがエージェントの振る舞いを訂正しても、それを自分の
# 判断で恒久ルールにしてはならない」と定めている。だが文章は読まれることを期待するだけで、
# 実行時には何も止めない。実際にエージェントが CLAUDE.md を無断で書き換える事故が起きた。
# 本 hook はその文面を実行時に強制する。
#
# 方式: 拒否ではなく permissionDecision: "ask" を返す。ルールを作ること自体は必要なので、
# 止めるのではなくユーザーの明示的な許可を通す。承認済みかどうかをエージェントに判断させない、
# というのがこの hook の要点。
#
# 対象パス: CLAUDE.md / .claude/hooks/ / .claude/rules/ / 自動メモリ(projects/*/memory/)。
#
# 既知の限界: Bash 経路はコマンド文字列の照合なので網羅ではない。変数展開でパスを組み立てる、
# ヒアドキュメント内にパスを書く、エディタを起動する、といった経路は検知できない。
# 完全な封鎖ではなく、既定の書き込み手段を塞ぐ安全網として設計している。
#
# 出力規約: 対象外ならなにも出力せず exit 0。対象なら ask を返す。いかなる場合も exit 0。

input="$(cat)"

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"

# 恒久ルールを構成するパスか判定する
is_rule_path() {
  case "$1" in
    */CLAUDE.md|CLAUDE.md) return 0 ;;
    */.claude/hooks/*) return 0 ;;
    */.claude/rules/*) return 0 ;;
    */.claude/projects/*/memory/*) return 0 ;;
    *) return 1 ;;
  esac
}

target=""

case "$tool_name" in
  Write|Edit|MultiEdit|NotebookEdit)
    file_path="$(echo "$input" | jq -r '.tool_input.file_path // empty')"
    [ -n "$file_path" ] || exit 0
    is_rule_path "$file_path" || exit 0
    target="$file_path"
    ;;
  Bash)
    command_text="$(echo "$input" | jq -r '.tool_input.command // empty')"
    [ -n "$command_text" ] || exit 0

    # 読み取りだけの参照で毎回プロンプトを出さないよう、書き込みを伴う形に限定する
    case "$command_text" in
      *">"*|*"tee "*|*"sed -i"*|*"perl -i"*|*"perl -pi"*|*"perl -0pi"*|*"cp "*|*"mv "*|*"rm "*|*"truncate"*|*"dd "*) ;;
      *) exit 0 ;;
    esac

    # コマンド文字列に恒久ルールのパスが現れるか照合する
    case "$command_text" in
      *CLAUDE.md*) target="CLAUDE.md" ;;
      *.claude/hooks/*) target=".claude/hooks/" ;;
      *.claude/rules/*) target=".claude/rules/" ;;
      *memory/*) target="自動メモリ (memory/)" ;;
      *) exit 0 ;;
    esac
    ;;
  *)
    exit 0
    ;;
esac

reason="恒久ルールにあたる ${target} へ書き込もうとしています。CLAUDE.md の Decision により、ユーザーの訂正を自分の判断で恒久ルールにすることは禁止されています。ルール化の要否を決めるのはユーザーです。承認がまだなら、入れる文面をそのまま引用し、書き込み先のファイル名を示して提案し直してください。承認済みならこのまま許可してください。"

jq -n --arg reason "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: $reason}}'
exit 0
