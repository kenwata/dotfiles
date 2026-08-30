#!/usr/bin/env bash
set -u

# This adapter is wired only into custom-agent role files. Adding agent_id
# deliberately activates the shared Claude policy without blocking the main
# Codex thread.
input="$(cat)"
printf '%s' "$input" \
  | jq '.agent_id = (.agent_id // "codex-custom-agent")' \
  | bash "$HOME/.claude/hooks/deny-subagent-git-write.sh"
