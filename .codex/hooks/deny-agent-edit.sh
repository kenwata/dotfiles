#!/usr/bin/env bash
set -u

input="$(cat)"
tool_name="$(printf '%s' "$input" | jq -r '.tool_name // empty')"

case "$tool_name" in
  Write|Edit|apply_patch)
    printf '%s\n' \
      "Blocked: this review-only custom agent cannot use file-editing tools." \
      "Report the required change to the main context instead." >&2
    exit 2
    ;;
esac

exit 0
