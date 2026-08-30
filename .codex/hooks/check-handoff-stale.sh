#!/usr/bin/env bash
set -u

# Codex SessionStart JSON is not needed by the shared implementation.
cat >/dev/null
exec bash "$HOME/.claude/hooks/check-handoff-stale.sh"
