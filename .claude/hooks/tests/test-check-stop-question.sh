#!/bin/bash
# check-stop-question.sh の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-check-stop-question.sh
# 終了コード 2 = 応答終了を差し戻す、0 = 素通し。

hook="$(cd "$(dirname "$0")/.." && pwd)/check-stop-question.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
failures=0

# 引数: テスト名 / 期待する終了コード / stderr に含まれるべき文字列(空なら stderr も空を期待) / 入力 JSON
run_case() {
  local name="$1" expected_code="$2" expected_stderr="$3" input="$4"
  local stderr_file="$work_dir/stderr"

  printf '%s' "$input" | bash "$hook" >/dev/null 2>"$stderr_file"
  local actual_code=$?

  if [ "$actual_code" -ne "$expected_code" ]; then
    echo "FAIL $name: exit=$actual_code expected=$expected_code"; failures=$((failures + 1)); return
  fi
  if [ -z "$expected_stderr" ] && [ -s "$stderr_file" ]; then
    echo "FAIL $name: stderr should be empty"; failures=$((failures + 1)); return
  fi
  if [ -n "$expected_stderr" ] && ! grep -q "$expected_stderr" "$stderr_file"; then
    echo "FAIL $name: stderr lacks '$expected_stderr'"; failures=$((failures + 1)); return
  fi
  echo "ok   $name"
}

stop_input() {
  jq -n --arg msg "$1" --argjson active "${2:-false}" \
    '{hook_event_name: "Stop", session_id: "s1", stop_hook_active: $active, last_assistant_message: $msg}'
}

run_case "blocks_when_message_ends_with_japanese_question" 2 "自動ゲート" \
  "$(stop_input $'修正しました。\n\nこの方針でよいでしょうか。')"
run_case "blocks_when_message_ends_with_question_mark" 2 "自動ゲート" \
  "$(stop_input $'二つの案があります。\nどちらにしますか？')"
run_case "blocks_when_message_requests_user_review" 2 "自動ゲート" \
  "$(stop_input $'対象は次の4件です。\nご確認のうえ readiness label を教えてください。')"
run_case "passes_when_message_is_plain_report" 0 "" \
  "$(stop_input $'T32 が完了しました。コミットは 90ca242 です。')"
run_case "passes_when_question_is_only_in_the_middle" 0 "" \
  "$(stop_input $'「どちらが正しいか？」を一次情報で確認しました。\n\n結果は次のとおりです。\n- A は正しい\n- B は誤りなので修正した\n- 検査は通過した\n- コミット済み\n以上です。')"
run_case "passes_on_reentry_after_block" 0 "" \
  "$(stop_input 'この方針でよいでしょうか。' true)"
run_case "passes_for_subagent" 0 "" \
  "$(jq -n '{hook_event_name: "Stop", agent_id: "a1", stop_hook_active: false, last_assistant_message: "これでよいですか？"}')"
run_case "passes_on_empty_input" 0 "" ""
run_case "passes_on_invalid_json" 0 "" "not json"
run_case "passes_when_message_missing_and_no_transcript" 0 "" \
  "$(jq -n '{hook_event_name: "Stop", stop_hook_active: false}')"

transcript="$work_dir/transcript.jsonl"
jq -nc '{type: "user", message: {content: "x"}}' >"$transcript"
jq -nc '{type: "assistant", message: {content: [{type: "text", text: "直しました。\nこれで進めてよいですか？"}]}}' >>"$transcript"
run_case "blocks_using_transcript_when_message_field_absent" 2 "自動ゲート" \
  "$(jq -n --arg p "$transcript" '{hook_event_name: "Stop", stop_hook_active: false, transcript_path: $p}')"

run_case "blocks_with_realistic_input_having_path_but_no_agent_id" 2 "自動ゲート" \
  "$(jq -n --arg p "$transcript" '{hook_event_name: "Stop", session_id: "s1", transcript_path: $p, cwd: "/tmp", stop_hook_active: false, last_assistant_message: "どちらにしますか？"}')"

# 連続実行ループが駆動するセッション(sessions/<id>.json に loop がある)は差し戻さない。無いセッションは従来どおり
export XDG_STATE_HOME="$work_dir/state"
mkdir -p "$XDG_STATE_HOME/claude-task-loop/sessions"
echo '{"session_id":"loop1","loop":{"task":"T7"}}' > "$XDG_STATE_HOME/claude-task-loop/sessions/loop1.json"
echo '{"session_id":"s2","budget":{"stage":1}}' > "$XDG_STATE_HOME/claude-task-loop/sessions/s2.json"
run_case "passes_for_loop_driven_session" 0 "" \
  "$(jq -n '{hook_event_name: "Stop", session_id: "loop1", stop_hook_active: false, last_assistant_message: "どちらにしますか？"}')"
run_case "blocks_for_session_state_without_loop" 2 "自動ゲート" \
  "$(jq -n '{hook_event_name: "Stop", session_id: "s2", stop_hook_active: false, last_assistant_message: "どちらにしますか？"}')"
run_case "blocks_for_session_id_with_path_characters" 2 "自動ゲート" \
  "$(jq -n '{hook_event_name: "Stop", session_id: "../loop1", stop_hook_active: false, last_assistant_message: "どちらにしますか？"}')"

if [ "$failures" -ne 0 ]; then
  echo "FAILED: $failures"
  exit 1
fi
echo "PASS"
