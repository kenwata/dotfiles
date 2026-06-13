#!/usr/bin/env bash
set -euo pipefail

# Usage: disband.sh <team> [--yes]
#
# Disbands a team completely: removes the team registration, deletes all
# agmsg messages for that team from the database, and releases any actas
# exclusivity locks associated with the team.
#
# What is NOT removed:
#   - Claude Code session transcripts (~/.claude-bedrock/projects/.../*.jsonl)
#     These are keyed by project path, not team name, so removing them would
#     affect all teams sharing the same project.
#   - watch.sh pidfiles / delivery cursors / cc-instance files
#     These are keyed by session-id, not team name; session-end.sh handles
#     their cleanup when each CC session exits.
#
# Options:
#   --yes   Skip the confirmation prompt (required when stdin is not a tty).

TEAM="${1:?Usage: disband.sh <team> [--yes]}"
YES=false
shift
for arg in "$@"; do
  case "$arg" in
    --yes) YES=true ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TEAMS_DIR="$SKILL_DIR/teams"
TEAM_CONFIG="$TEAMS_DIR/$TEAM/config.json"

# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/storage.sh"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/actas-lock.sh"

DB="$(agmsg_db_path)"

# --- Validate team exists ---
if [ ! -f "$TEAM_CONFIG" ]; then
  echo "Team not found: $TEAM" >&2
  exit 1
fi

# --- Show members about to be removed ---
CONFIG_ESCAPED=$(sed "s/'/''/g" "$TEAM_CONFIG")
MEMBERS=$(sqlite3 :memory: ".param set :json '$CONFIG_ESCAPED'" \
  "SELECT group_concat(key, ', ') FROM json_each(json_extract(:json, '\$.agents'));")
echo "Team:    $TEAM"
echo "Members: ${MEMBERS:-<none>}"
if [ -f "$DB" ]; then
  MSG_COUNT=$(sqlite3 "$DB" "SELECT count(*) FROM messages WHERE team='$(printf '%s' "$TEAM" | sed "s/'/''/g")';")
  echo "Messages in DB: $MSG_COUNT"
fi
echo ""
echo "This will delete:"
echo "  - teams/$TEAM/ (team registration)"
echo "  - All messages in messages.db for this team"
echo "  - Any actas lock files for this team"
echo ""

# --- Confirmation ---
if [ "$YES" = true ]; then
  : # proceed without prompting
elif [ -t 0 ]; then
  # Interactive: ask for confirmation
  printf 'Disband team "%s"? [y/N] ' "$TEAM"
  read -r answer
  case "$answer" in
    y|Y|yes|YES) ;;
    *) echo "Aborted." ; exit 0 ;;
  esac
else
  # Non-interactive without --yes: refuse to proceed (safety guard)
  echo "stdin is not a tty. Pass --yes to confirm disbanding without a prompt." >&2
  exit 1
fi

# --- Delete messages from DB ---
MSG_DELETED=0
if [ -f "$DB" ]; then
  TEAM_ESC=$(printf '%s' "$TEAM" | sed "s/'/''/g")
  MSG_DELETED=$(sqlite3 "$DB" "DELETE FROM messages WHERE team='$TEAM_ESC'; SELECT changes();")
fi

# --- Release actas locks for this team ---
LOCK_DIR="$SKILL_DIR/run"
LOCK_DELETED=0
if [ -d "$LOCK_DIR" ]; then
  ENC_TEAM="$(_actas_lock_encode "$TEAM")"
  for f in "$LOCK_DIR/actas.${ENC_TEAM}__"*.session; do
    [ -f "$f" ] || continue
    rm -f "$f"
    LOCK_DELETED=$((LOCK_DELETED + 1))
  done
fi

# --- Remove team registration directory ---
rm -rf "$TEAMS_DIR/$TEAM"

# --- Summary ---
echo "Disbanded team: $TEAM"
echo "  Messages deleted: $MSG_DELETED"
echo "  Locks released:   $LOCK_DELETED"
echo ""
echo "Note: any running sessions that were acting as members of this team"
echo "still hold stale team state in memory. They will fail to send/receive"
echo "messages for this team. Each affected session can be restarted or"
echo "re-joined to a new team via join.sh."
