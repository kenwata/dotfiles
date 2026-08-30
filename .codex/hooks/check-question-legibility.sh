#!/usr/bin/env bash
set -u

# Claude's hook uses the same permission-decision output shape. Translate only
# the local function-tool name and keep its one-shot marker behavior intact.
input="$(cat)"
printf '%s' "$input" \
  | jq '.tool_name = "AskUserQuestion"' \
  | bash "$HOME/.claude/hooks/check-question-legibility.sh"
