#!/usr/bin/env bash
# PostToolUse + Stop + SessionStart hook: $execute-task の実行中、compact の前にエージェントを区切らせる予算停止。
# Codex の hook JSON は Claude と同じ形(session_id / transcript_path / tool_response / cwd)なので、共有実装
# ~/.claude/hooks/context-budget.mjs を引数 codex で起動する(使用量は transcript_path の rollout の末尾から読む)。
# このセッションの $execute-task の実行中の状態(check-task-scope.mjs が ${TMPDIR}/claude-task-scope/<session_id>.json に
# 置き、12 時間で失効する)が無ければ、node を起動せずに抜ける(Stop / SessionStart も同じ判定。$execute-task の外では
# compact の記録を読む相手が無い)。古い状態の掃除は Claude の statusline.sh(セッションごとの最初の書き出し時)と
# task-loop の起動時が持つ。Codex だけのマシンでは 48 時間の掃除がループの起動時にしか走らない。
set -u

input="$(cat)"
state_dir="${TMPDIR:-/tmp}/claude-task-scope"
key="$(printf '%s' "$input" | jq -r '.session_id // empty' 2>/dev/null | tr -d '\n' | tr -c 'A-Za-z0-9._-' '_')"
if [[ -n "$key" ]] && [[ -z "$(find "$state_dir" -maxdepth 1 -name "$key.json" -mmin -720 2>/dev/null)" ]]; then
  exit 0
fi

node_bin="$(command -v node 2>/dev/null || true)"
if [[ -z "$node_bin" ]] && command -v mise >/dev/null 2>&1; then
  node_bin="$(mise which node 2>/dev/null || true)"
fi
[[ -n "$node_bin" && -x "$node_bin" ]] || exit 0

exec "$node_bin" "$HOME/.claude/hooks/context-budget.mjs" codex <<<"$input"
