#!/usr/bin/env bash
# PostToolUse + Stop + PostCompact + SessionStart hook: /execute-task の実行中、compact の前にエージェントを
# 区切らせる予算停止(本体は同名 .mjs)
#
# PostToolUse は全ツール呼び出しで発火する。/execute-task の実行中の状態(check-task-scope.mjs が
# ${TMPDIR}/claude-task-scope/<セッション>.json に置く。worker-lock-* は別物)がどのセッションにも無ければ、
# node を起動せずに抜ける(通常の対話に起動の遅延を持ち込まない)
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

exec "$node_bin" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/context-budget.mjs" claude
