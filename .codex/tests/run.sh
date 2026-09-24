#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
fixture_root="$(mktemp -d)"
trap 'rm -rf "$fixture_root"' EXIT

fake_home="$fixture_root/home"
fake_codex="$fake_home/.codex"
backup="$fixture_root/backup"
mkdir -p "$fake_codex/skills/.system" "$fake_codex/sessions"
printf 'secret-placeholder\n' > "$fake_codex/auth.json"
printf 'system-marker\n' > "$fake_codex/skills/.system/marker"
printf 'session-marker\n' > "$fake_codex/sessions/marker"
mkdir -p "$fake_codex/agents"
printf 'legacy-advisor\n' > "$fake_codex/agents/advisor.toml"
ln -s "$repo_root/.codex/agents/proposal-reviewer.toml" "$fake_codex/agents/proposal-reviewer.toml"
printf 'legacy-codebase-explorer\n' > "$fake_codex/agents/codebase-explorer.toml"
mkdir -p "$backup/agents"
printf 'existing-proposal-reviewer-backup\n' > "$backup/agents/proposal-reviewer.toml"
printf '%s\n' \
  'model = "old-model"' \
  'notify = ["runtime-notifier"]' \
  '' \
  '[agents.advisor]' \
  'config_file = "./agents/advisor.toml"' \
  '' \
  '[hooks.state."runtime-hook"]' \
  'trusted_hash = "sha256:runtime"' \
  '' \
  '[plugins."runtime-plugin"]' \
  'enabled = true' \
  > "$fake_codex/config.toml"

HOME="$fake_home" CODEX_WORKER_HOME= bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fake_codex" "$backup"
HOME="$fake_home" CODEX_WORKER_HOME= bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fake_codex" "$backup"

[[ ! -L "$fake_codex/config.toml" ]]
[[ -L "$fake_codex/hooks.json" ]]
[[ "$(readlink "$fake_codex/hooks.json")" == "$repo_root/.codex/user-hooks.json" ]]
[[ -f "$backup/config.toml" ]]
grep -q 'old-model' "$backup/config.toml"
# 既に入っているモデルの選択はテンプレートより優先する(install で古い版へ巻き戻さない)
[[ "$(yq -p=toml -o=json -r '.model' "$fake_codex/config.toml")" == "old-model" ]]
[[ "$(yq -p=toml -o=json -r '.model_reasoning_effort' "$fake_codex/config.toml")" == "$(yq -p=toml -o=json -r '.model_reasoning_effort' "$repo_root/.codex/user-config.toml")" ]]
[[ "$(yq -p=toml -o=json -r '.notify[0]' "$fake_codex/config.toml")" == "runtime-notifier" ]]
[[ "$(yq -p=toml -o=json -r '.hooks.state."runtime-hook".trusted_hash' "$fake_codex/config.toml")" == "sha256:runtime" ]]
[[ "$(yq -p=toml -o=json -r '.plugins."runtime-plugin".enabled' "$fake_codex/config.toml")" == "true" ]]
[[ "$(yq -p=toml -o=json -r '.agents.advisor // "absent"' "$fake_codex/config.toml")" == "absent" ]]
[[ "$(yq -p=toml -o=json -r '.agents.proposal_reviewer.config_file' "$fake_codex/config.toml")" == "./agents/proposal-reviewer.toml" ]]
[[ "$(yq -p=toml -o=json -r '.sandbox_workspace_write.writable_roots[0]' "$fake_codex/config.toml")" == "$fake_home/.agents/skills/agmsg/run" ]]
grep -qx 'secret-placeholder' "$fake_codex/auth.json"
grep -qx 'system-marker' "$fake_codex/skills/.system/marker"
grep -qx 'session-marker' "$fake_codex/sessions/marker"
[[ -L "$fake_codex/skills/follow-up" ]]
[[ -L "$fake_codex/skills/elaborate" ]]
[[ -L "$fake_codex/skills/amend" ]]
grep -qx 'existing-proposal-reviewer-backup' "$backup/agents/proposal-reviewer.toml"
migrated_proposal_reviewer_backup="$(find "$backup/agents" -maxdepth 1 -type l -name 'proposal-reviewer.toml.*')"
[[ -n "$migrated_proposal_reviewer_backup" ]]
[[ -L "$migrated_proposal_reviewer_backup" ]]
[[ "$(readlink "$migrated_proposal_reviewer_backup")" == "$repo_root/.codex/agents/proposal-reviewer.toml" ]]
[[ "$(find "$backup/agents" -maxdepth 1 -type l -name 'proposal-reviewer.toml.*' | wc -l | tr -d ' ')" -eq 1 ]]
grep -qx 'legacy-advisor' "$backup/agents/advisor.toml"
[[ ! -e "$fake_codex/agents/advisor.toml" && ! -L "$fake_codex/agents/advisor.toml" ]]
grep -qx 'legacy-codebase-explorer' "$backup/agents/codebase-explorer.toml"
for source_path in "$repo_root"/.codex/agents/*.toml; do
  installed_path="$fake_codex/agents/$(basename "$source_path")"
  [[ -f "$installed_path" ]]
  [[ ! -L "$installed_path" ]]
  cmp -s "$source_path" "$installed_path"
done

fresh_home="$fixture_root/fresh-home"
fresh_codex="$fresh_home/.codex"
mkdir -p "$fresh_codex" "$fixture_root/agents-real"
# ~/.agents が dotfiles へのリンクである実環境を再現する。writable_roots はリンクを解決した実体パスで書き出される
ln -s "$fixture_root/agents-real" "$fresh_home/.agents"
HOME="$fresh_home" CODEX_WORKER_HOME= bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fresh_codex" "$fixture_root/fresh-backup"
[[ -s "$fresh_codex/config.toml" ]]
# 新規インストールではテンプレートの値が既定になる
[[ "$(yq -p=toml -o=json -r '.model' "$fresh_codex/config.toml")" == "$(yq -p=toml -o=json -r '.model' "$repo_root/.codex/user-config.toml")" ]]
[[ "$(yq -p=toml -o=json -r '.sandbox_workspace_write.writable_roots[0]' "$fresh_codex/config.toml")" == "$(cd -P "$fixture_root/agents-real" && pwd -P)/skills/agmsg/run" ]]

# worker 用ホーム: 設定は複製、認証は通常ホームへのリンク、AGENTS.md・hooks・skills は置かない
fresh_worker="$fresh_home/.codex-worker"
cmp -s "$repo_root/.codex/worker-config.toml" "$fresh_worker/config.toml"
[[ -L "$fresh_worker/auth.json" && "$(readlink "$fresh_worker/auth.json")" == "$fresh_codex/auth.json" ]]
[[ ! -e "$fresh_worker/AGENTS.md" && ! -e "$fresh_worker/hooks.json" && ! -e "$fresh_worker/skills" ]]
[[ "$(yq -p=toml -o=json -r '.project_doc_max_bytes' "$fresh_worker/config.toml")" == "0" ]]
# ネットワークは loopback だけ: 外への口は管理プロキシに通し、許可するドメインを持たない
[[ "$(yq -p=toml -o=json -r '.sandbox_workspace_write.network_access' "$fresh_worker/config.toml")" == "true" ]]
[[ "$(yq -p=toml -o=json -r '.features.network_proxy.enabled' "$fresh_worker/config.toml")" == "true" ]]
[[ "$(yq -p=toml -o=json -r '.features.network_proxy.allow_local_binding' "$fresh_worker/config.toml")" == "true" ]]
[[ "$(yq -p=toml -o=json -r '[.. | select(has("allowed_domains") or has("domains"))] | length' "$fresh_worker/config.toml")" == "0" ]]
[[ "$(yq -p=toml -o=json -r '.model // "unset"' "$fresh_worker/config.toml")" == "unset" ]]
# 再実行しても差分が無ければ何も置き換えない
reinstall_output="$(HOME="$fresh_home" CODEX_WORKER_HOME= bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fresh_codex" "$fixture_root/fresh-backup2")"
printf '%s' "$reinstall_output" | grep -q 'worker auth already linked'
[[ ! -e "$fixture_root/fresh-backup2/worker" ]]
# Codex が書き足す信頼設定の表は、置き換えの判定から除く
printf '\n[projects."/tmp/p"]\ntrust_level = "trusted"\n' >> "$fresh_worker/config.toml"
HOME="$fresh_home" CODEX_WORKER_HOME= bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fresh_codex" "$fixture_root/fresh-backup3" > /dev/null
[[ ! -e "$fixture_root/fresh-backup3/worker" ]]
[[ -f "$fresh_codex/agents/proposal-reviewer.toml" ]]
[[ ! -L "$fresh_codex/agents/proposal-reviewer.toml" ]]
cmp -s "$repo_root/.codex/agents/proposal-reviewer.toml" "$fresh_codex/agents/proposal-reviewer.toml"

printf '%s\n' \
  '#!/usr/bin/env bash' \
  '[[ "$1" == "session" ]]' \
  'cat > "$HOME/herdr-input.actual"' \
  > "$fake_codex/herdr-agent-state.sh"
printf '%s' '{"hook_event_name":"SessionStart","session_id":"test-session","transcript_path":"/tmp/transcript.jsonl"}' \
  > "$fake_home/herdr-input.expected"
HOME="$fake_home" bash "$repo_root/.codex/hooks/herdr-agent-state.sh" \
  < "$fake_home/herdr-input.expected"
cmp "$fake_home/herdr-input.expected" "$fake_home/herdr-input.actual"

node --test "$repo_root/.codex/tests/hooks.test.mjs"
node --test "$repo_root/.claude/hooks/lib/mainline-gauge/test/gauge.test.mjs"
node --test "$repo_root/.claude/hooks/lib/codex-worker/test/core.test.mjs"
node --test "$repo_root/.claude/hooks/lib/codex-worker/test/cli.test.mjs"
node --test "$repo_root/.claude/hooks/lib/codex-worker/test/worklog.test.mjs"
node --test "$repo_root/.claude/hooks/lib/codex-worker/test/status.test.mjs"
node --test "$repo_root/.claude/hooks/lib/task-loop/test/"*.test.mjs
node --test "$repo_root/.claude/hooks/lib/code-layout/test/"*.test.mjs
bash "$repo_root/.claude/hooks/tests/test-check-code-layout.sh" >/dev/null
bash "$repo_root/.claude/hooks/tests/test-context-budget.sh" >/dev/null

safe_git_output="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | bash "$repo_root/.codex/hooks/deny-git-write.sh")"
[[ -z "$safe_git_output" ]]

set +e
blocked_git_output="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git commit -m test"}}' \
  | bash "$repo_root/.codex/hooks/deny-git-write.sh" 2>&1)"
blocked_git_status=$?
set -e
[[ "$blocked_git_status" -eq 2 ]]
printf '%s' "$blocked_git_output" | grep -q 'git commit'

set +e
blocked_edit_output="$(printf '%s' '{"tool_name":"apply_patch","tool_input":{"command":"*** Begin Patch"}}' \
  | bash "$repo_root/.codex/hooks/deny-agent-edit.sh" 2>&1)"
blocked_edit_status=$?
set -e
[[ "$blocked_edit_status" -eq 2 ]]
printf '%s' "$blocked_edit_output" | grep -q 'cannot use file-editing tools'

safe_read_output="$(printf '%s' '{"tool_name":"Bash","tool_input":{"command":"git status"}}' \
  | bash "$repo_root/.codex/hooks/deny-agent-edit.sh")"
[[ -z "$safe_read_output" ]]

[[ "$(rg -l 'deny-agent-edit.sh' "$repo_root/.codex/agents"/*.toml | wc -l | tr -d ' ')" -eq 4 ]]

# The shared Markdown gate defaults to Claude's .claude/rules alone, so every Codex
# caller of cli.mjs must opt into .codex explicitly. The adapter's own behaviour is
# covered by hooks.test.mjs; the cleanup skill is prose, so assert its flags here —
# without them the skill silently no-ops in a Codex-initialized project.
rg -q -- '--rules-dir=\.codex --rules-dir=\.claude' \
  "$repo_root/.codex/skills/markdown-cleanup/SKILL.md"
rg -q -- '--rules-dir=\.codex' "$repo_root/.codex/hooks/format-markdown.mjs"
rg -q -- '--rules-dir=\.codex' "$repo_root/.codex/hooks/check-code-layout.mjs"

question_session="codex-test-$$"
question_input="$(jq -nc --arg id "$question_session" \
  '{session_id:$id,tool_name:"request_user_input",tool_input:{questions:[]}}')"
first_question="$(printf '%s' "$question_input" \
  | bash "$repo_root/.codex/hooks/check-question-legibility.sh")"
second_question="$(printf '%s' "$question_input" \
  | bash "$repo_root/.codex/hooks/check-question-legibility.sh")"
printf '%s' "$first_question" | jq -e \
  '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
[[ -z "$second_question" ]]

hook_repo="$fixture_root/hook-repo"
mkdir -p "$hook_repo/docs"
git -C "$hook_repo" init -q
printf '# Architecture\n' > "$hook_repo/docs/architecture.md"
new_dir_input="$(jq -nc --arg cwd "$hook_repo" \
  '{cwd:$cwd,tool_name:"apply_patch",tool_input:{command:"*** Begin Patch\n*** Add File: src/new/file.md\n+# New\n*** End Patch"}}')"
new_dir_output="$(printf '%s' "$new_dir_input" \
  | bash "$repo_root/.codex/hooks/check-new-directory.sh")"
printf '%s' "$new_dir_output" | jq -e \
  '.hookSpecificOutput.additionalContext | contains("src/new")' >/dev/null

printf '{"b":1,"a":2}\n' > "$fixture_root/valid.json"
bash "$repo_root/.config/git/json-normalize.sh" \
  < "$fixture_root/valid.json" > "$fixture_root/valid.actual"
jq -S . "$fixture_root/valid.json" > "$fixture_root/valid.expected"
cmp "$fixture_root/valid.expected" "$fixture_root/valid.actual"

printf 'not-json\n\n' > "$fixture_root/invalid.json"
bash "$repo_root/.config/git/json-normalize.sh" \
  < "$fixture_root/invalid.json" > "$fixture_root/invalid.actual"
cmp "$fixture_root/invalid.json" "$fixture_root/invalid.actual"

: > "$fixture_root/empty.json"
bash "$repo_root/.config/git/json-normalize.sh" \
  < "$fixture_root/empty.json" > "$fixture_root/empty.actual"
[[ ! -s "$fixture_root/empty.actual" ]]

scope_repo="$fixture_root/scope-repo"
mkdir -p "$scope_repo/src/a" "$scope_repo/src/b"
git -C "$scope_repo" init -q
printf '%s\n' '| #1-1 | T7 | x | 中 | — | [ ] |' '' '**#1-1 / T7** — 完了条件: 対象: `src/a/`。' > "$scope_repo/TODO.md"
scope_home="$fixture_root/scope-home"
mkdir -p "$scope_home/.claude"
ln -s "$repo_root/.claude/hooks" "$scope_home/.claude/hooks"
scope_tmp="$fixture_root/scope-tmp"
mkdir -p "$scope_tmp"
jq -nc --arg c "$scope_repo" '{hook_event_name:"UserPromptSubmit",session_id:"scope-s",cwd:$c,prompt:"$execute-task T7"}' \
  | HOME="$scope_home" TMPDIR="$scope_tmp" bash "$repo_root/.codex/hooks/check-task-scope.sh"
scope_deny="$(jq -nc --arg c "$scope_repo" '{hook_event_name:"PreToolUse",session_id:"scope-s",cwd:$c,tool_name:"apply_patch",tool_input:{command:"*** Begin Patch\n*** Update File: src/b/x.ts\n@@\n+y\n*** End Patch"}}' \
  | HOME="$scope_home" TMPDIR="$scope_tmp" bash "$repo_root/.codex/hooks/check-task-scope.sh")"
printf '%s' "$scope_deny" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null
scope_allow="$(jq -nc --arg c "$scope_repo" '{hook_event_name:"PreToolUse",session_id:"scope-s",cwd:$c,tool_name:"apply_patch",tool_input:{command:"*** Begin Patch\n*** Update File: src/a/x.ts\n@@\n+y\n*** End Patch"}}' \
  | HOME="$scope_home" TMPDIR="$scope_tmp" bash "$repo_root/.codex/hooks/check-task-scope.sh")"
[[ -z "$scope_allow" ]]

# 予算停止: インストールした形(HOME の .claude/hooks は symlink)で Codex のラッパーから起動し、
# $execute-task の実行中に rollout の使用量が一段目(Codex 既定 60%)を超えたら 1 回だけ差し込む
budget_rollout="$fixture_root/rollout.jsonl"
jq -nc '{type:"event_msg",payload:{type:"token_count",info:{last_token_usage:{total_tokens:170000},model_context_window:258400}}}' \
  > "$budget_rollout"
budget_input="$(jq -nc --arg c "$scope_repo" --arg t "$budget_rollout" \
  '{hook_event_name:"PostToolUse",session_id:"scope-s",turn_id:"u1",cwd:$c,transcript_path:$t,tool_name:"exec_command",tool_response:"ok"}')"
run_budget() {
  printf '%s' "$budget_input" | HOME="$scope_home" TMPDIR="$scope_tmp" XDG_STATE_HOME="$fixture_root/budget-state" \
    XDG_CONFIG_HOME="$fixture_root/budget-config" bash "$repo_root/.codex/hooks/context-budget.sh"
}
run_budget | jq -e '.hookSpecificOutput.additionalContext | contains("context-budget 1/2")' >/dev/null
[[ -z "$(run_budget)" ]]

printf 'Codex migration tests passed\n'
