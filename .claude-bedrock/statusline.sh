#!/bin/bash

input=$(cat)

MODEL=$(echo "$input" | jq -r '.model.display_name // "?"')
DIR=$(echo "$input" | jq -r '.workspace.current_dir // .cwd // "?"')
COST=$(echo "$input" | jq -r '.cost.total_cost_usd // 0')
DURATION_MS=$(echo "$input" | jq -r '.cost.total_duration_ms // 0')

CTX=$(echo "$input" | jq -r '.context_window.used_percentage // 0')
FIVE_H=$(echo "$input" | jq -r '.rate_limits.five_hour.used_percentage // empty')
WEEK=$(echo "$input" | jq -r '.rate_limits.seven_day.used_percentage // empty')
SESSION_ID=$(echo "$input" | jq -r '.session_id // "unknown"')

CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
GRAY='\033[90m'
RESET='\033[0m'

make_bar() {
  local pct="$1"
  local width="${2:-10}"

  [ -z "$pct" ] && return

  pct=$(printf '%.0f' "$pct" 2>/dev/null)

  [ -z "$pct" ] && return
  [ "$pct" -lt 0 ] && pct=0
  [ "$pct" -gt 100 ] && pct=100

  local filled=$((pct * width / 100))
  local empty=$((width - filled))

  local fill=""
  local pad=""
  local bar=""

  [ "$filled" -gt 0 ] && printf -v fill "%${filled}s" && bar="${fill// /█}"
  [ "$empty" -gt 0 ] && printf -v pad "%${empty}s" && bar="${bar}${pad// /░}"

  if [ "$pct" -ge 90 ]; then
    echo -e "${RED}${bar}${RESET} ${pct}%"
  elif [ "$pct" -ge 70 ]; then
    echo -e "${YELLOW}${bar}${RESET} ${pct}%"
  else
    echo -e "${GREEN}${bar}${RESET} ${pct}%"
  fi
}

# git info cache
CACHE_FILE="/tmp/claude-statusline-git-${SESSION_ID}"
CACHE_MAX_AGE=5

cache_is_stale() {
  [ ! -f "$CACHE_FILE" ] || \
  [ $(($(date +%s) - $(stat -f %m "$CACHE_FILE" 2>/dev/null || stat -c %Y "$CACHE_FILE" 2>/dev/null || echo 0))) -gt "$CACHE_MAX_AGE" ]
}

if cache_is_stale; then
  if git rev-parse --git-dir > /dev/null 2>&1; then
    BRANCH=$(git branch --show-current 2>/dev/null)
    STAGED=$(git diff --cached --numstat 2>/dev/null | wc -l | tr -d ' ')
    MODIFIED=$(git diff --numstat 2>/dev/null | wc -l | tr -d ' ')
    UNTRACKED=$(git ls-files --others --exclude-standard 2>/dev/null | wc -l | tr -d ' ')
    echo "$BRANCH|$STAGED|$MODIFIED|$UNTRACKED" > "$CACHE_FILE"
  else
    echo "|||" > "$CACHE_FILE"
  fi
fi

IFS='|' read -r BRANCH STAGED MODIFIED UNTRACKED < "$CACHE_FILE"

GIT_STATUS=""
[ -n "$BRANCH" ] && GIT_STATUS=" | 🌿 ${CYAN}${BRANCH}${RESET}"
[ "${STAGED:-0}" -gt 0 ] && GIT_STATUS="${GIT_STATUS} ${GREEN}+${STAGED}${RESET}"
[ "${MODIFIED:-0}" -gt 0 ] && GIT_STATUS="${GIT_STATUS} ${YELLOW}~${MODIFIED}${RESET}"
[ "${UNTRACKED:-0}" -gt 0 ] && GIT_STATUS="${GIT_STATUS} ${RED}?${UNTRACKED}${RESET}"

CTX_BAR=$(make_bar "$CTX" 10)

LIMIT_BARS=""
if [ -n "$FIVE_H" ]; then
  FIVE_H_BAR=$(make_bar "$FIVE_H" 6)
  LIMIT_BARS="${LIMIT_BARS} | 5h ${FIVE_H_BAR}"
fi

if [ -n "$WEEK" ]; then
  WEEK_BAR=$(make_bar "$WEEK" 6)
  LIMIT_BARS="${LIMIT_BARS} | 1w ${WEEK_BAR}"
fi

MINS=$((DURATION_MS / 60000))
SECS=$(((DURATION_MS % 60000) / 1000))
COST_FMT=$(printf '$%.2f' "$COST")

echo -e "${CYAN}[$MODEL]${RESET} 📁 ${DIR##*/}${GIT_STATUS}"
echo -e "ctx ${CTX_BAR}${LIMIT_BARS} | ${YELLOW}${COST_FMT}${RESET} | ⏱️ ${MINS}m ${SECS}s"
