#!/bin/bash
# check-task-scope.sh の振る舞いテスト。実行: bash ~/.claude/hooks/tests/test-check-task-scope.sh
# 状態は TMPDIR 配下に置かれるので、テスト専用の TMPDIR で実行して実セッションの状態と混ぜない。

hook="$(cd "$(dirname "$0")/.." && pwd)/check-task-scope.sh"
work_dir="$(mktemp -d)"
trap 'rm -rf "$work_dir"' EXIT
export TMPDIR="$work_dir/tmp"
mkdir -p "$TMPDIR"
failures=0

repo="$work_dir/repo"
mkdir -p "$repo/src/ai-workflows/contracts" "$repo/tests/ai-workflows" "$repo/src/area-analysis" "$repo/docs/design"
git -C "$repo" init -q
cat > "$repo/TODO.md" <<'TODO'
| #2-9 | T43 | AI出力の共通外枠のJSON Schemaを追加する | 中 | — | [ ] |
| #2-10 | T44 | Codex CLI を1回起動する | 中 | — | [ ] |
| #2-11 | T45 | 完了済み | 中 | — | [x] |

**#2-9 / T43** — 完了条件: 対象: `src/ai-workflows/contracts/`、`tests/ai-workflows/`。依存: T11。(1) 外枠が版IDを持つ。
**#2-10 / T44** — 完了条件: 対象: `src/research-runs/`、調整用ケース。依存: T43。
**#2-11 / T45** — 完了条件: 対象: `src/x/`。
| #2-12 | T46 | 注記付き | 中 | — | [ ] |
**#2-12 / T46** — 完了条件: 対象: `src/ai-workflows/`（契約の定義は `contracts/` の下位ディレクトリ）、`tests/ai-workflows/`。依存: T11。
TODO

# 引数: テスト名 / 期待(deny|warn|silent) / 入力 JSON
run_case() {
  local name="$1" expected="$2" input="$3"
  local out
  out="$(printf '%s' "$input" | bash "$hook" 2>/dev/null)"
  local code=$?
  if [ "$code" -ne 0 ]; then echo "FAIL $name: exit=$code"; failures=$((failures + 1)); return; fi
  local actual="silent"
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then actual="deny"
  elif printf '%s' "$out" | jq -e '.hookSpecificOutput.additionalContext' >/dev/null 2>&1; then actual="warn"; fi
  if [ "$actual" != "$expected" ]; then echo "FAIL $name: got $actual expected $expected: $out"; failures=$((failures + 1)); return; fi
  echo "ok   $name"
}

prompt_input() { jq -nc --arg s "$1" --arg p "$2" --arg c "$repo" '{hook_event_name:"UserPromptSubmit",session_id:$s,cwd:$c,prompt:$p}'; }
write_input() { jq -nc --arg s "$1" --arg f "$2" --arg c "$repo" '{hook_event_name:"PreToolUse",session_id:$s,cwd:$c,tool_name:"Write",tool_input:{file_path:$f}}'; }
patch_input() { jq -nc --arg s "$1" --arg f "$2" --arg c "$repo" '{hook_event_name:"PreToolUse",session_id:$s,cwd:$c,tool_name:"apply_patch",tool_input:{command:("*** Begin Patch\n*** Update File: " + $f + "\n@@\n+x\n*** End Patch")}}'; }

run_case "silent_without_state" silent "$(write_input s1 "$repo/src/area-analysis/context.ts")"

run_case "records_state_on_execute_task" silent "$(prompt_input s1 "/execute-task T43")"
run_case "denies_edit_outside_scope" deny "$(write_input s1 "$repo/src/area-analysis/context.ts")"
run_case "allows_edit_inside_scope" silent "$(write_input s1 "$repo/src/ai-workflows/contracts/new.ts")"
run_case "allows_edit_inside_test_scope_via_relative_path" silent "$(write_input s1 "tests/ai-workflows/new.test.ts")"
run_case "allows_state_documents" silent "$(write_input s1 "$repo/HANDOFF.md")"
run_case "allows_design_reference_fix" silent "$(write_input s1 "$repo/docs/design/x.md")"
run_case "ignores_paths_outside_repo" silent "$(write_input s1 "$work_dir/scratch.md")"
run_case "denies_codex_apply_patch_outside_scope" deny "$(patch_input s1 "src/area-analysis/context.ts")"
run_case "allows_codex_apply_patch_inside_scope" silent "$(patch_input s1 "src/ai-workflows/contracts/a.ts")"
run_case "plain_prompt_keeps_state" silent "$(prompt_input s1 "続けて")"
run_case "still_denies_after_plain_prompt" deny "$(write_input s1 "$repo/src/area-analysis/context.ts")"
run_case "other_session_is_unaffected" silent "$(write_input s2 "$repo/src/area-analysis/context.ts")"

run_case "codex_dollar_prefix_records_state" silent "$(prompt_input s3 "\$execute-task T44")"
run_case "warns_only_when_scope_has_prose" warn "$(write_input s3 "$repo/src/area-analysis/context.ts")"

run_case "completed_task_is_inert" silent "$(prompt_input s4 "/execute-task T45")"
run_case "completed_task_allows_anything" silent "$(write_input s4 "$repo/src/area-analysis/context.ts")"

run_case "other_command_clears_state" silent "$(prompt_input s1 "/follow-up")"
run_case "silent_after_state_cleared" silent "$(write_input s1 "$repo/src/area-analysis/context.ts")"

run_case "annotated_path_records_state" silent "$(prompt_input s5 "/execute-task T46")"
run_case "annotated_path_counts_as_path_and_denies" deny "$(write_input s5 "$repo/src/area-analysis/context.ts")"
run_case "annotated_path_allows_inside" silent "$(write_input s5 "$repo/src/ai-workflows/contracts/a.ts")"

sub_start() { jq -nc --arg s "$1" --arg t "$2" --arg a "$3" --arg c "$repo" '{hook_event_name:"SubagentStart",session_id:$s,cwd:$c,agent_type:$t,agent_id:$a}'; }
sub_stop() { jq -nc --arg s "$1" --arg t "$2" --arg a "$3" --arg c "$repo" '{hook_event_name:"SubagentStop",session_id:$s,cwd:$c,agent_type:$t,agent_id:$a}'; }
sub_write() { jq -nc --arg s "$1" --arg a "$2" --arg f "$3" --arg c "$repo" '{hook_event_name:"PreToolUse",session_id:$s,cwd:$c,agent_id:$a,tool_name:"Write",tool_input:{file_path:$f}}'; }

run_case "review_start_sets_flag" silent "$(sub_start s6 proposal-reviewer a1)"
run_case "denies_main_edit_while_review_pending_without_execute_task" deny "$(write_input s6 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "allows_subagent_edit_while_review_pending" silent "$(sub_write s6 impl1 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "review_pending_isolated_per_session" silent "$(write_input s7 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "second_reviewer_keeps_flag_after_first_stops" silent "$(sub_start s6 diff_reviewer a2)"
run_case "first_review_stop" silent "$(sub_stop s6 proposal-reviewer a1)"
run_case "still_denied_while_second_reviewer_runs" deny "$(write_input s6 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "second_review_stop" silent "$(sub_stop s6 diff_reviewer a2)"
run_case "allows_edit_after_all_reviews_stop" silent "$(write_input s6 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "non_review_agent_does_not_block" silent "$(sub_start s6 codebase-explorer a3)"
run_case "edit_allowed_with_explorer_running" silent "$(write_input s6 "$repo/src/ai-workflows/contracts/a.ts")"
run_case "stale_review_flag_expires" silent "$(sub_start s8 proposal-reviewer a9)"
touch -t 202001010000 "$TMPDIR/claude-task-scope/s8.review-a9"
run_case "edit_allowed_after_review_flag_expired" silent "$(write_input s8 "$repo/src/ai-workflows/contracts/a.ts")"

run_case "silent_on_invalid_json" silent "not json"
run_case "silent_on_empty_input" silent ""

if [ "$failures" -ne 0 ]; then echo "$failures failure(s)"; exit 1; fi
echo "all passed"
