#!/usr/bin/env bash
# UserPromptSubmit + PreToolUse(apply_patch) + SubagentStart/Stop hook: $execute-task の対象パス検査と
# レビュー待ち中の編集拒否。
# Codex の hook JSON は Claude と同じ形(session_id / prompt / tool_name / tool_input / cwd)なので、
# 共有実装 ~/.claude/hooks/check-task-scope.mjs をそのまま起動する(apply_patch の解析は本体側)。
set -u

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$HOME/.claude/hooks/check-task-scope.mjs"
