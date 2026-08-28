#!/bin/bash
# PreToolUse(AskUserQuestion) hook: ユーザー向け確認文の可読性ゲート
#
# エージェントがユーザーへの確認質問(AskUserQuestion)で主語・述語・目的語を省略し、
# 作業中に自分が付けた内輪の名前・関数名・タスクIDを定義なしに使い、ユーザーに伝わらない
# 文を出す再発が繰り返された。静的なルール(CLAUDE.md・auto memory)は既にコンテキストへ
# ロードされていても、確認文を書く瞬間には想起されず、再発を防げなかった。本 hook は
# AskUserQuestion の呼び出しをセッションあたり1回だけ機械的に deny し、チェックリストで
# 書き直しを強制することで、静的ルールでは届かない「書いた瞬間」に介入する。
#
# 動作: 直前に deny していない呼び出しは deny してチェックリストを返す(理由文は
# permissionDecisionReason としてモデルにのみ見える。ユーザー画面には出ない)。
# 直後の再呼び出しは素通しする(session_id 単位のワンショット・マーカー、30分で失効)。
#
# 既知の限界: AskUserQuestion 以外の確認文(プレーンテキストの本文、ExitPlanMode の
# プラン提示)には発火しない。マーカーは「直前の deny の後、AskUserQuestion を呼ばずに
# 放置し、後で無関係な新しい質問を呼ぶ」場合にその新しい質問を誤って素通しすることがある
# (AskUserQuestion の呼び出し頻度が低いため許容する)。
#
# 出力規約: 対象外・異常時は何も出力せず exit 0(フェイルオープン)。deny 時のみ JSON を
# 出力する。いかなる場合も exit 0(質問機能自体を止めない)。

input="$(cat)"

tool_name="$(echo "$input" | jq -r '.tool_name // empty')"
[ "$tool_name" = "AskUserQuestion" ] || exit 0

session_id="$(echo "$input" | jq -r '.session_id // empty')"
[ -n "$session_id" ] || exit 0

marker_dir="${TMPDIR:-/tmp}/claude-question-legibility"
mkdir -p "$marker_dir" 2>/dev/null || exit 0
chmod 700 "$marker_dir" 2>/dev/null
marker_file="$marker_dir/${session_id}.pending"

# 直前の deny から30分以内の再呼び出しは素通し(マーカーを消費)
if [ -n "$(find "$marker_file" -mmin -30 2>/dev/null)" ]; then
  rm -f "$marker_file"
  exit 0
fi

# マーカー無し、または30分超で失効: 今回分を新規に deny する
rm -f "$marker_file" 2>/dev/null
touch "$marker_file" 2>/dev/null || exit 0

reason="これは自動の文章品質ゲートであり、ユーザーによる拒否ではありません。ユーザーはこの質問をまだ見ていません。送信前に以下を自己点検し、必要な箇所を書き直してから、必ず AskUserQuestion をもう一度呼び出してください(プレーンテキストの質問に切り替えないこと)。書き直し後の呼び出しはそのまま通過します。

点検項目:
1. 全文に主語・述語・目的語があるか(誰が・何を・何に対して)
2. 自分が付けた名前・変数名・関数名・ケース番号・略語で、ユーザーがこの会話でまだ見ていないものは、同じメッセージ内で「それが何で、どこにあり、何をするものか」を定義したか
3. タスクIDや固有名を出す場合、「それが何か」「なぜ今の判断に効くか」を書式「内容(ID)」の順で書いたか
4. 専門用語に注釈をつけたか
5. 「前回の」「上記の」等の後方参照ではなく、中身を再掲したか
6. 確認対象がファイルなら、開くパスを書いたか
7. 読み手はコード・ツール出力・スクリーンショットを見ていない前提で、初見でも通じる文か
8. 選択肢欄に収まらない定義や背景は、ツール呼び出し前のメッセージ本文に書いたか(短くまとめることを伝達より優先しない)

定義は同一メッセージ内の初出1回で足ります。全文で繰り返して冗長にする必要はなく、質問の意図や選択肢の構造も変えないでください。"

jq -n --arg reason "$reason" '{hookSpecificOutput: {hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: $reason}}'
exit 0
