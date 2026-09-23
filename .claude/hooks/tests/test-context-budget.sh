#!/bin/bash
# context-budget.sh / context-budget.mjs の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-context-budget.sh
# 状態は TMPDIR(/execute-task の実行中の状態)と XDG_STATE_HOME(予算・作業記録)に置かれるので、テスト専用の
# 置き場で実行して実セッションの状態と混ぜない。窓は 1000 トークンにして、使用量をそのまま % で読めるようにする。

hooks_dir="$(cd "$(dirname "$0")/.." && pwd)"
hook="$hooks_dir/context-budget.sh"
scope_hook="$hooks_dir/check-task-scope.sh"
note_cli="$hooks_dir/lib/codex-worker/cli.mjs"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
export TMPDIR="$work_dir/tmp" XDG_STATE_HOME="$work_dir/state" XDG_CONFIG_HOME="$work_dir/config"
mkdir -p "$TMPDIR"
failures=0

repo="$work_dir/repo"
mkdir -p "$repo"
git -C "$repo" init -q
repo="$(git -C "$repo" rev-parse --show-toplevel)"
cat > "$repo/TODO.md" <<'TODO'
| #1-1 | T7 | 実装する | — | [ ] |
| #1-2 | T8 | 済んだ | — | [x] |

**#1-1 / T7** — 完了条件: 対象: `src/`。
**#1-2 / T8** — 完了条件: 対象: `src/`。
TODO
slug="$(printf '%s' "$repo" | sed 's/[^A-Za-z0-9]/-/g')"
worklog="$XDG_STATE_HOME/claude-codex-worker/tasks/$slug/T7/worklog.md"
sessions="$XDG_STATE_HOME/claude-task-loop/sessions"

# 引数: テスト名 / 期待(silent|stage1|stage2|block|pass|json) / 入力 JSON / 実行するコマンド(省略時は Claude のラッパー)
run_case() {
  local name="$1" expected="$2" input="$3"
  shift 3
  local out err code
  if [ "$#" -eq 0 ]; then set -- bash "$hook"; fi
  out="$(printf '%s' "$input" | "$@" 2>"$work_dir/stderr")"
  code=$?
  err="$(cat "$work_dir/stderr")"
  local actual
  if [ "$code" -eq 2 ] && printf '%s' "$err" | grep -q "handoff がありません"; then actual="block"
  elif [ "$code" -ne 0 ]; then actual="exit$code"
  elif printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | test("context-budget 1/2")' >/dev/null 2>&1; then actual="stage1"
  elif printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext | test("context-budget 2/2")' >/dev/null 2>&1; then actual="stage2"
  elif [ "$out" = "{}" ]; then actual="json"
  elif [ -z "$out" ]; then actual="silent"
  else actual="other:$out"; fi
  [ "$expected" = "pass" ] && [ "$actual" = "silent" ] && actual="pass"
  if [ "$actual" != "$expected" ]; then echo "FAIL $name: got $actual expected $expected ($err)"; failures=$((failures + 1)); return; fi
  echo "ok   $name"
}

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then echo "ok   $name"; else echo "FAIL $name"; failures=$((failures + 1)); fi
}

start_task() { jq -nc --arg s "$1" --arg p "$2" --arg c "$repo" '{hook_event_name:"UserPromptSubmit",session_id:$s,cwd:$c,prompt:$p}' | bash "$scope_hook" >/dev/null; }
# statusline のサイドファイル(窓 1000、使用量 = 第 2 引数)
usage() {
  mkdir -p "$XDG_STATE_HOME/claude-task-loop/statusline"
  jq -nc --arg s "$1" --argjson t "$2" '{session_id:$s,used_percentage:($t/10),context_window_size:1000,current_usage:{input_tokens:$t,cache_creation_input_tokens:0,cache_read_input_tokens:0}}' \
    > "$XDG_STATE_HOME/claude-task-loop/statusline/$1.json"
}
tool_use() { jq -nc --arg s "$1" --arg c "$repo" --arg r "${2:-ok}" '{hook_event_name:"PostToolUse",session_id:$s,cwd:$c,tool_name:"Bash",tool_input:{command:"x"},tool_response:$r}'; }
stop() { jq -nc --arg s "$1" --arg c "$repo" --argjson a "${2:-false}" '{hook_event_name:"Stop",session_id:$s,cwd:$c,stop_hook_active:$a}'; }

# /execute-task がどこでも実行されていなければ、ラッパーは node を起動せずに抜ける
usage s1 900
run_case "silent_without_any_execute_task_state" silent "$(tool_use s1)"
run_case "silent_on_invalid_json" silent "not json"
run_case "silent_on_empty_input" silent ""

start_task s1 "/execute-task T7"
run_case "silent_for_session_without_execute_task" silent "$(tool_use s0)"
run_case "silent_for_subagent" silent "$(jq -nc --arg c "$repo" '{hook_event_name:"PostToolUse",session_id:"s1",agent_id:"a1",cwd:$c,tool_response:"x"}')"
run_case "silent_without_statusline_side_file" silent "$(tool_use s9)"

usage s1 500
run_case "silent_below_stage1" silent "$(tool_use s1)"
usage s1 720
run_case "stage1_once_at_threshold" stage1 "$(tool_use s1)"
usage s1 730
run_case "stage1_not_repeated" silent "$(tool_use s1)"
usage s1 810
run_case "stage2_at_threshold" stage2 "$(tool_use s1)"
usage s1 830
run_case "stage2_not_repeated_within_step" silent "$(tool_use s1)"
usage s1 860
run_case "stage2_renotice_after_5_points" stage2 "$(tool_use s1)"
check "worklog_has_budget_entries" test "$(grep -c 'kind=budget' "$worklog")" -eq 3
check "session_state_has_stage2" jq -e '.budget.stage == 2 and .budget.task == "T7" and .budget.stage2_at > 0' "$sessions/s1.json"

start_task s2 "/execute-task T7"
usage s2 650
run_case "tool_response_estimate_is_added" stage1 "$(tool_use s2 "$(printf 'x%.0s' $(seq 1 400))")"

run_case "stop_blocks_without_handoff" block "$(stop s1)"
run_case "stop_passes_on_reentry" pass "$(stop s1 true)"
run_case "stop_passes_below_stage2" pass "$(stop s2)"
node "$note_cli" note --root "$repo" --task T7 --kind handoff --step 2 --text "s2 の途中。途中成果物 src/a.ts" >/dev/null
run_case "stop_passes_after_handoff" pass "$(stop s1)"

start_task s3 "/execute-task T8"
usage s3 950
run_case "stage2_for_closed_task" stage2 "$(tool_use s3)"
run_case "stop_passes_when_task_is_done" pass "$(stop s3)"

# statusline.sh が実際に書くサイドファイルを hook が読む(手で組み立てた fixture ではなく実物の書き出しで契約を確かめる)。
# 最初の書き出しの時に 2 日より古い状態を掃除することも見る
statusline="$hooks_dir/../statusline.sh"
start_task s5 "/execute-task T7"
mkdir -p "$XDG_STATE_HOME/claude-task-loop/statusline" "$sessions"
echo '{}' > "$XDG_STATE_HOME/claude-task-loop/statusline/stale.json"
echo '{}' > "$sessions/stale.json"
touch -t 202001010000 "$XDG_STATE_HOME/claude-task-loop/statusline/stale.json" "$sessions/stale.json"
jq -nc '{session_id:"s5",model:{display_name:"x"},context_window:{used_percentage:85,context_window_size:1000,current_usage:{input_tokens:800,cache_creation_input_tokens:50,cache_read_input_tokens:0,output_tokens:9}},rate_limits:{five_hour:{used_percentage:12}}}' \
  | (cd "$repo" && bash "$statusline" >/dev/null 2>&1)
rm -f "/tmp/claude-statusline-git-s5"
check "statusline_writes_side_file" jq -e '.session_id == "s5" and .context_window_size == 1000 and .current_usage.input_tokens == 800 and .five_hour_pct == 12' "$XDG_STATE_HOME/claude-task-loop/statusline/s5.json"
check "statusline_prunes_stale_state" test ! -e "$XDG_STATE_HOME/claude-task-loop/statusline/stale.json" -a ! -e "$sessions/stale.json"
run_case "stage2_from_real_statusline_output" stage2 "$(tool_use s5)"

mkdir -p "$XDG_CONFIG_HOME/claude-task-loop"
echo '{"claude":{"stage1":40,"stage2":90}}' > "$XDG_CONFIG_HOME/claude-task-loop/config.json"
start_task s4 "/execute-task T7"
usage s4 450
run_case "config_file_sets_thresholds" stage1 "$(tool_use s4)"
rm -f "$XDG_CONFIG_HOME/claude-task-loop/config.json"

run_case "post_compact_is_recorded" silent "$(jq -nc --arg c "$repo" '{hook_event_name:"PostCompact",session_id:"s1",cwd:$c,trigger:"auto"}')"
check "post_compact_in_session_state" jq -e '.compact.trigger == "auto"' "$sessions/s1.json"
check "post_compact_in_worklog" grep -q 'kind=compact .*trigger=auto' "$worklog"

# Codex: 使用量は rollout(transcript_path)の末尾の token_count。起動ラッパーは引数 codex を渡す
codex_hook=(node "$hooks_dir/context-budget.mjs" codex)
rollout="$work_dir/rollout.jsonl"
token_count() { jq -nc --argjson t "$1" '{type:"event_msg",payload:{type:"token_count",info:{last_token_usage:{total_tokens:$t},model_context_window:258400}}}'; }
{ token_count 20000; head -c 300000 /dev/zero | tr '\0' 'x'; echo; token_count 160000; } > "$rollout"
codex_tool_use() { jq -nc --arg c "$repo" --arg t "$1" '{hook_event_name:"PostToolUse",session_id:"c1",turn_id:"u1",model:"gpt-6-luna",cwd:$c,transcript_path:$t,tool_response:"ok"}'; }
start_task c1 '$execute-task T7'
run_case "codex_stage1_from_rollout_tail" stage1 "$(codex_tool_use "$rollout")" "${codex_hook[@]}"
token_count 185000 >> "$rollout"
run_case "codex_stage2_at_70_percent" stage2 "$(codex_tool_use "$rollout")" "${codex_hook[@]}"
run_case "codex_silent_without_transcript" silent "$(jq -nc --arg c "$repo" '{hook_event_name:"PostToolUse",session_id:"c1",turn_id:"u1",cwd:$c,transcript_path:null}')" "${codex_hook[@]}"
run_case "codex_stop_prints_json_when_passing" json "$(jq -nc --arg c "$repo" '{hook_event_name:"Stop",session_id:"c9",turn_id:"u1",cwd:$c,stop_hook_active:false}')" "${codex_hook[@]}"
run_case "codex_session_start_compact_is_recorded" silent "$(jq -nc --arg c "$repo" '{hook_event_name:"SessionStart",session_id:"c1",cwd:$c,source:"compact"}')" "${codex_hook[@]}"
check "codex_compact_in_session_state" jq -e '.compact.trigger == "codex"' "$sessions/c1.json"

# SessionStart は 48 時間より古いセッションの状態を掃除する
echo '{}' > "$sessions/old.json"
touch -t 202001010000 "$sessions/old.json"
run_case "session_start_sweeps" silent "$(jq -nc --arg c "$repo" '{hook_event_name:"SessionStart",session_id:"s1",cwd:$c,source:"startup"}')"
check "old_session_state_removed" test ! -e "$sessions/old.json"
check "recent_session_state_kept" test -e "$sessions/s1.json"

if [ "$failures" -ne 0 ]; then
  echo "FAILED: $failures"
  exit 1
fi
echo "PASS"
