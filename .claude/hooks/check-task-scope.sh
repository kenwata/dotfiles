#!/usr/bin/env bash
# UserPromptSubmit + PreToolUse(Write|Edit) + SubagentStart/Stop hook: /execute-task の対象パス検査と
# レビュー待ち中の編集拒否(本体は同名 .mjs)
set -u

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-task-scope.mjs"
