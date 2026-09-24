#!/usr/bin/env bash
# PreToolUse(Write|Edit|apply_patch) hook: 冒頭の規約コメントを持つ .md を、本文の編集で壊す書き込みを
# 拒否する。Codex の hook JSON は Claude と同じ形(tool_name / tool_input / cwd)なので、共有実装
# ~/.claude/hooks/check-header-comment.mjs をそのまま起動する(apply_patch の解析は本体側)。
set -u

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$HOME/.claude/hooks/check-header-comment.mjs"
