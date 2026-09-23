#!/bin/bash
# Stop hook: プレーンテキストの問いかけで応答を終えようとした時に、一度だけ差し戻す自律判断ゲート
#
# 目的はユーザーに確認させることではなく、その逆。エージェントが「聞いて止まる」ことを減らし、
# 自分で決めて作業を続けさせる(ユーザーのレビューを限りなくゼロに近づける)。
#
# 経緯(2026-09-19): check-question-legibility.sh は AskUserQuestion の呼び出しにしか発火せず、
# 本文に質問を書いて応答を終える経路は素通しだった(同 hook の「既知の限界」)。同日のセッションでは
# 確認がすべてこの経路で行われ、「事実誤りの修正可否を聞く」「優劣の付く二択を聞く」「ファイルパスを
# 並べてレビューを丸投げする」が再発した。いずれも CLAUDE.md と auto memory に規則が既にあり、
# コンテキストにも載っていたが、書く瞬間には効かなかった。静的な文章では届かない「応答を終える瞬間」に
# 機械的に介入する。
#
# ユーザーから振る舞いの指摘を受けた時は、auto memory や CLAUDE.md ではなく、まず下の点検リストに足す。
#
# 動作: 最終メッセージの末尾が問いかけ・依頼なら exit 2 で差し戻す(理由文は stderr 経由でモデルにだけ
# 渡る)。差し戻し後の再終了は stop_hook_active=true で素通しするため、1 回の終了につき最大 1 回。
# 対象外・異常時は何も出さず exit 0(フェイルオープン)。サブエージェントには適用しない。
#
# 連続実行ループ(lib/task-loop/cli.mjs)が駆動するセッション(${XDG_STATE_HOME:-~/.local/state}/claude-task-loop/
# sessions/<session_id>.json に loop がある)も素通しする(2026-09-23)。無人の実行では問いかけに答える人がおらず、
# 止まったセッションはループが成果物で判定して人へ渡す。手で操作するセッションには影響しない。

# 末尾の何行を「応答の締め」とみなすか。締めの問いかけだけを拾い、本文途中の引用や見出しの「？」を拾わない幅
readonly CLOSING_LINE_COUNT=3

# 問いかけ・ユーザーへの依頼で終わる文末表現
readonly QUESTION_PATTERN='[?？]|(です|ます|でしょう|ません)か[。 ]*$|いかがでしょう|(教えて|確認して|ご確認|ご判断|お知らせ|選んで|決めて)[^。]*(ください|いただけ|願い)'

input="$(cat)"
[ -n "$input" ] || exit 0

printf '%s' "$input" | jq -e 'type == "object"' >/dev/null 2>&1 || exit 0
[ "$(printf '%s' "$input" | jq -r '.stop_hook_active // false')" = "true" ] && exit 0
[ -n "$(printf '%s' "$input" | jq -r '.agent_id // empty')" ] && exit 0
session_key="$(printf '%s' "$input" | jq -r '.session_id // empty' | tr -d '\n' | tr -c 'A-Za-z0-9._-' '_')"
loop_state="${XDG_STATE_HOME:-$HOME/.local/state}/claude-task-loop/sessions/${session_key}.json"
[ -n "$session_key" ] && [ -f "$loop_state" ] && jq -e '.loop != null' "$loop_state" >/dev/null 2>&1 && exit 0
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"

message="$(printf '%s' "$input" | jq -r '.last_assistant_message // empty' 2>/dev/null)"
if [ -z "$message" ] && [ -r "$transcript_path" ]; then
  message="$(jq -rs '[.[] | select(.type == "assistant") | .message.content[]? | select(.type == "text") | .text] | last // empty' "$transcript_path" 2>/dev/null)"
fi
[ -n "$message" ] || exit 0

closing="$(printf '%s\n' "$message" | grep -v '^[[:space:]]*$' | tail -n "$CLOSING_LINE_COUNT")"
printf '%s\n' "$closing" | grep -Eq "$QUESTION_PATTERN" || exit 0

cat >&2 <<'REASON'
これは自動ゲートであり、ユーザーの発言ではありません。あなたの直前のメッセージはユーザーへの問いかけ・依頼で終わっています。このユーザーの目標は「エージェントが自律的に決め、ユーザーのレビューを限りなくゼロにする」ことです。以下を上から点検し、最初に当てはまった出口を取ってください。

1. 事実との食い違い・誤り・漏れを直してよいか聞いていないか → 一次情報で確認済みなら、聞かずに直して作業を続ける。確認がまだなら確認してから直す。
2. 選択を聞いていないか → 整合性と正しさを取る「べき論」(既存の設計原則・先例との整合、事実との一致)で結論を 1 つ出し、可逆で権限内なら実行して作業を続ける。選択肢を並べて選ばせるだけで終わらない。判断軸は仕組みとしての完成度であり、手直しの少なさではない(~/.claude/CLAUDE.md の Decision)。
3. 迷いながらべき論で決めたか、決めた後も不確実性が残るか → 質問にせず、決めた内容と理由を成果物の中(レコードの未確認事項・変更履歴、判断ログなど該当する場所)に残して作業を続ける。記録があれば後から意図を追えるので、ユーザーの事前確認は要らない。
4. 残作業があるのに「次へ進んでよいか」と聞いていないか → 聞かずに進む。
5. それでも聞いてよいのは次のいずれかに限る: (a) 複数の選択肢に等しく当てはまり、べき論でも優劣が付かない (b) 不可逆 (c) 権限・費用・外部状態の範囲を超える (d) ユーザーの意図でしか決まらない。その時は次を満たすこと:
   - 自分の結論と理由を先に述べる
   - レビューを頼むなら、ファイルパスの列挙で丸投げせず、対象 1 件の中身と自分の所見(確認済みの事実・懸念点)を示す。複数件を一度に投げない
   - 主語・述語・目的語を省かず、この会話でユーザーがまだ見ていない名前・ID・略語は同じメッセージ内で定義する
   - 出口 5 に当たると判断した理由を 1 文添える

出口 1〜4 を取った場合は、作業を続けたうえで、決めた内容・理由・影響範囲を報告して終える。出口 5 の場合は、上の条件を満たす形に書き直して終える。
REASON
exit 2
