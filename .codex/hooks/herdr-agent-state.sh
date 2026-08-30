#!/usr/bin/env bash
set -u

state_hook="$HOME/.codex/herdr-agent-state.sh"
[[ -f "$state_hook" ]] || exit 0
exec bash "$state_hook" session
