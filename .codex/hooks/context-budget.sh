#!/usr/bin/env bash
# PostToolUse + Stop + SessionStart hook: $execute-task の実行中、compact の前にエージェントを区切らせる予算停止。
# Codex の hook JSON は Claude と同じ形(session_id / transcript_path / tool_response / cwd)なので、共有実装
# ~/.claude/hooks/context-budget.mjs を引数 codex で起動する(使用量は transcript_path の rollout の末尾から読む)。
# $execute-task の実行中の状態(check-task-scope.mjs が ${TMPDIR}/claude-task-scope/<セッション>.json に置く。
# worker-lock-* は別物)がどのセッションにも無ければ、node を起動せずに抜ける。
set -u

state_dir="${TMPDIR:-/tmp}/claude-task-scope"
has_state=0
for file in "$state_dir"/*.json; do
  [[ -e "$file" ]] || break
  case "${file##*/}" in worker-lock-*) continue ;; esac
  has_state=1
  break
done
if [[ "$has_state" != 1 ]]; then
  cat >/dev/null
  exit 0
fi

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$HOME/.claude/hooks/context-budget.mjs" codex
