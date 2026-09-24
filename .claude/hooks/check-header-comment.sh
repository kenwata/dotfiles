#!/usr/bin/env bash
# PreToolUse(Write|Edit) hook: 冒頭の規約コメントを持つ .md を、本文の編集で壊す書き込みを拒否する
# (本体は同名 .mjs)
set -u

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/check-header-comment.mjs"
