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
ln -s "$repo_root/.codex/agents/advisor.toml" "$fake_codex/agents/advisor.toml"
printf 'legacy-codebase-explorer\n' > "$fake_codex/agents/codebase-explorer.toml"
mkdir -p "$backup/agents"
printf 'existing-advisor-backup\n' > "$backup/agents/advisor.toml"
printf '%s\n' \
  'model = "old-model"' \
  'notify = ["runtime-notifier"]' \
  '' \
  '[hooks.state."runtime-hook"]' \
  'trusted_hash = "sha256:runtime"' \
  '' \
  '[plugins."runtime-plugin"]' \
  'enabled = true' \
  > "$fake_codex/config.toml"

HOME="$fake_home" bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fake_codex" "$backup"
HOME="$fake_home" bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fake_codex" "$backup"

[[ ! -L "$fake_codex/config.toml" ]]
[[ -L "$fake_codex/hooks.json" ]]
[[ "$(readlink "$fake_codex/hooks.json")" == "$repo_root/.codex/user-hooks.json" ]]
[[ -f "$backup/config.toml" ]]
grep -q 'old-model' "$backup/config.toml"
[[ "$(yq -p=toml -o=json -r '.model' "$fake_codex/config.toml")" == "gpt-5.6-sol" ]]
[[ "$(yq -p=toml -o=json -r '.notify[0]' "$fake_codex/config.toml")" == "runtime-notifier" ]]
[[ "$(yq -p=toml -o=json -r '.hooks.state."runtime-hook".trusted_hash' "$fake_codex/config.toml")" == "sha256:runtime" ]]
[[ "$(yq -p=toml -o=json -r '.plugins."runtime-plugin".enabled' "$fake_codex/config.toml")" == "true" ]]
[[ "$(yq -p=toml -o=json -r '.sandbox_workspace_write.writable_roots[0]' "$fake_codex/config.toml")" == "$fake_home/.agents/skills/agmsg/run" ]]
grep -qx 'secret-placeholder' "$fake_codex/auth.json"
grep -qx 'system-marker' "$fake_codex/skills/.system/marker"
grep -qx 'session-marker' "$fake_codex/sessions/marker"
[[ -L "$fake_codex/skills/follow-up" ]]
grep -qx 'existing-advisor-backup' "$backup/agents/advisor.toml"
migrated_advisor_backup="$(find "$backup/agents" -maxdepth 1 -type l -name 'advisor.toml.*')"
[[ -n "$migrated_advisor_backup" ]]
[[ -L "$migrated_advisor_backup" ]]
[[ "$(readlink "$migrated_advisor_backup")" == "$repo_root/.codex/agents/advisor.toml" ]]
[[ "$(find "$backup/agents" -maxdepth 1 -type l -name 'advisor.toml.*' | wc -l | tr -d ' ')" -eq 1 ]]
grep -qx 'legacy-codebase-explorer' "$backup/agents/codebase-explorer.toml"
for source_path in "$repo_root"/.codex/agents/*.toml; do
  installed_path="$fake_codex/agents/$(basename "$source_path")"
  [[ -f "$installed_path" ]]
  [[ ! -L "$installed_path" ]]
  cmp -s "$source_path" "$installed_path"
done

fresh_home="$fixture_root/fresh-home"
fresh_codex="$fresh_home/.codex"
mkdir -p "$fresh_codex"
HOME="$fresh_home" bash "$repo_root/.codex/install.sh" \
  "$repo_root/.codex" "$fresh_codex" "$fixture_root/fresh-backup"
[[ -s "$fresh_codex/config.toml" ]]
[[ "$(yq -p=toml -o=json -r '.model' "$fresh_codex/config.toml")" == "gpt-5.6-sol" ]]
[[ "$(yq -p=toml -o=json -r '.sandbox_workspace_write.writable_roots[0]' "$fresh_codex/config.toml")" == "$fresh_home/.agents/skills/agmsg/run" ]]
[[ -f "$fresh_codex/agents/advisor.toml" ]]
[[ ! -L "$fresh_codex/agents/advisor.toml" ]]
cmp -s "$repo_root/.codex/agents/advisor.toml" "$fresh_codex/agents/advisor.toml"

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

printf 'Codex migration tests passed\n'
