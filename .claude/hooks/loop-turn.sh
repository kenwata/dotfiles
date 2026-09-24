#!/usr/bin/env bash
# 連続実行ループが駆動するセッションのターンの状態を記録する hook の起動ラッパー(本体は同名 .mjs)
#
# PostToolUse は全ツール呼び出しで発火する。ループが書いた sessions/<session_id>.json に loop が無ければ、node を
# 起動せずに抜ける(通常の対話に起動の遅延を持ち込まない)。置き場の正は lib/task-loop/session-state.mjs
set -u

input="$(cat)"
state_dir="${XDG_STATE_HOME:-$HOME/.local/state}/claude-task-loop/sessions"
key="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null | tr -d '\n' | tr -c 'A-Za-z0-9._-' '_')"
[[ -n "$key" ]] || exit 0
jq -e '.loop' "$state_dir/$key.json" >/dev/null 2>&1 || exit 0

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/loop-turn.mjs" <<<"$input"
