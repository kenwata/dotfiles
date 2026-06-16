#!/usr/bin/env bash
set -euo pipefail

# SessionStart hook for delivery modes `monitor` and `both`.
#
# Usage: session-start.sh <type> <project_path>
#
# Reads the hook input JSON from stdin to extract the session_id, then emits
# an instruction telling Claude to invoke the Monitor tool against watch.sh.
# The hook input includes session_id for SessionStart events.
#
# Before emitting the directive, this script also takes care of preventing
# duplicate watchers across `/clear` (and similar) re-fires of SessionStart
# within the same Claude Code instance. State is kept in
# `~/.agents/agmsg/run/cc-instance.<cc_pid>`, which records the last
# session_id this CC instance attached to. On each fire we kill the watcher
# for the previous session_id, then record the new one. Multiple CC
# instances of the same project get their own cc_pid, so they never step
# on each other.
#
# Quietly exits 0 when whoami says the agent isn't joined to anything yet.
# Mode is implicit: if this script is being invoked at all, it's because
# `delivery.sh set monitor` (or `both`) installed it in the project's
# settings.local.json — that fact alone is the source of truth for "should
# we emit the directive?". No separate global mode value to consult.

TYPE="${1:?Usage: session-start.sh <type> <project_path>}"
PROJECT="${2:?Missing project_path}"

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SKILL_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
RUN_DIR="$SKILL_DIR/run"
# shellcheck disable=SC1091
source "$SCRIPT_DIR/lib/actas-lock.sh"

# Identity sanity check — no point launching a watcher with an empty pair set.
PAIRS=$("$SCRIPT_DIR/identities.sh" "$PROJECT" "$TYPE" 2>/dev/null || true)
[ -n "$PAIRS" ] || exit 0

# Read hook input JSON from stdin. session_id field is sent for SessionStart.
INPUT=$(cat 2>/dev/null || true)
SESSION_ID=""
if [ -n "$INPUT" ]; then
  SESSION_ID=$(printf '%s' "$INPUT" \
    | sed -n 's/.*"session_id"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' \
    | head -1)
fi
# Fallback so the instruction is still actionable even outside CC's hook flow.
[ -z "$SESSION_ID" ] && SESSION_ID="unknown-$$"

mkdir -p "$RUN_DIR" 2>/dev/null || true

# --- Identify the enclosing Claude Code process. ---
# Walk the parent chain looking for a process whose argv contains "claude".
# Stop at PID 1 or after a bounded number of hops. Returns empty when no
# match — in that case we skip the dedup step entirely.
find_cc_pid() {
  local pid="$$"
  local hops=0
  while [ "$pid" -gt 1 ] && [ "$hops" -lt 20 ]; do
    pid=$(ps -o ppid= -p "$pid" 2>/dev/null | tr -d ' ')
    [ -z "$pid" ] && return 1
    [ "$pid" = "0" ] && return 1
    local cmd
    cmd=$(ps -o args= -p "$pid" 2>/dev/null || true)
    # Match the actual claude binary, not e.g. "/bin/zsh -c '...claude...'"
    # by requiring the basename of the first token to be exactly "claude".
    local first
    first=$(printf '%s' "$cmd" | awk '{print $1}')
    if [ "$(basename -- "${first:-}")" = "claude" ]; then
      echo "$pid"
      return 0
    fi
    hops=$((hops + 1))
  done
  return 1
}

CC_PID=$(find_cc_pid 2>/dev/null || true)

# --- Cleanup of stale cc-instance files and their orphan watchers. ---
# A cc-instance.<pid> whose CC pid is dead is left over from a previous CC.
# Before removing it, optionally kill the watcher bound to its last
# session_id — but only if that session_id isn't still referenced by a
# LIVE cc-instance file. The same session_id can move from one CC pid to
# another (e.g. on `claude --continue` / `--resume`), so a dead-pid record
# alone is not evidence the session is gone.

# First pass: collect session_ids that are still referenced by a LIVE CC.
live_sids=""
for f in "$RUN_DIR"/cc-instance.*; do
  [ -f "$f" ] || continue
  pid=${f##*.}
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  if kill -0 "$pid" 2>/dev/null; then
    s=$(cat "$f" 2>/dev/null || true)
    [ -n "$s" ] && live_sids="$live_sids|$s"
  fi
done

# Second pass: clean each dead cc-instance, killing its bound watcher only
# when no live CC still references that session_id.
for f in "$RUN_DIR"/cc-instance.*; do
  [ -f "$f" ] || continue
  pid=${f##*.}
  case "$pid" in ''|*[!0-9]*) continue ;; esac
  kill -0 "$pid" 2>/dev/null && continue
  dead_sid=$(cat "$f" 2>/dev/null || true)
  if [ -n "$dead_sid" ] \
      && ! printf '%s\n' "$live_sids" | tr '|' '\n' | grep -Fxq "$dead_sid"; then
    orphan_pidfile="$RUN_DIR/watch.$dead_sid.pid"
    if [ -f "$orphan_pidfile" ]; then
      orphan_pid=$(cat "$orphan_pidfile" 2>/dev/null || true)
      if [ -n "$orphan_pid" ] && kill -0 "$orphan_pid" 2>/dev/null; then
        # Defensive: only kill if the pid's command line actually matches
        # our watch.sh. Defends against pid recycling — a stale pidfile
        # could point at an unrelated process that took the same pid.
        cmd=$(ps -o args= -p "$orphan_pid" 2>/dev/null || true)
        case "$cmd" in
          *"$SKILL_DIR/scripts/watch.sh"*) kill "$orphan_pid" 2>/dev/null || true ;;
          *) ;;  # not our watcher anymore; leave it alone
        esac
      fi
      rm -f "$orphan_pidfile"
    fi
    # The delivery cursor is only meaningful while its session can be
    # re-armed; a dead, unreferenced session won't be. (Skip the session
    # we are starting right now — defensive, ids should never collide.)
    [ "$dead_sid" != "$SESSION_ID" ] && rm -f "$RUN_DIR/cursor.$dead_sid"
  fi
  rm -f "$f"
done

# Same defensive pass for stale watcher pidfiles. A pidfile whose recorded
# pid is dead (or empty) means a watcher exited without running its EXIT
# trap — usually an edge case like SIGKILL or a synthesized session_id
# that SessionEnd's lookup couldn't match.
for f in "$RUN_DIR"/watch.*.pid; do
  [ -f "$f" ] || continue
  pid=$(cat "$f" 2>/dev/null || true)
  if [ -z "$pid" ]; then
    rm -f "$f"
    continue
  fi
  kill -0 "$pid" 2>/dev/null || rm -f "$f"
done

# Garbage-collect actas exclusivity locks whose owner session_id no longer
# maps to a live cc-instance. Must run after the dead cc-instance cleanup
# above, since the liveness check enumerates the remaining cc-instance.*
# files. See #62.
actas_lock_gc_stale >/dev/null 2>&1 || true


# --- Dedup against the previous watcher in this CC instance. ---
if [ -n "$CC_PID" ]; then
  STATE="$RUN_DIR/cc-instance.$CC_PID"
  if [ -f "$STATE" ]; then
    prev=$(cat "$STATE" 2>/dev/null || true)
    if [ -n "$prev" ] && [ "$prev" != "$SESSION_ID" ]; then
      prev_pidfile="$RUN_DIR/watch.$prev.pid"
      if [ -f "$prev_pidfile" ]; then
        prev_pid=$(cat "$prev_pidfile" 2>/dev/null || true)
        if [ -n "$prev_pid" ] && kill -0 "$prev_pid" 2>/dev/null; then
          kill "$prev_pid" 2>/dev/null || true
        fi
      fi
    fi
  fi
  printf '%s\n' "$SESSION_ID" > "$STATE"
fi

WATCH="$SKILL_DIR/scripts/watch.sh"

# --- Auto-actas: launch wrapper exported AGMSG_ACTAS=<role>. ---
# When a role-specific launcher (e.g. claude-planner, claude-coder) exports
# AGMSG_ACTAS=<role>, we short-circuit the manual `/agmsg actas` flow here:
# claim the exclusivity lock, narrow the watcher to <role>, and inject a
# FROM directive into the emitted instruction — all without any model action.
ACTAS_NAME="${AGMSG_ACTAS:-}"
WATCH_NAME=""    # appended to watch.sh command when claim succeeds
ACTAS_NOTE=""    # appended to the emitted directive when non-empty
if [ -n "$ACTAS_NAME" ]; then
  claim=$("$SCRIPT_DIR/actas-claim.sh" "$PROJECT" "$TYPE" "$ACTAS_NAME" "$SESSION_ID" 2>/dev/null || true)
  case "$claim" in
    status=ok*)
      WATCH_NAME="$ACTAS_NAME"
      ACTAS_NOTE="This session is acting as \`$ACTAS_NAME\` (agmsg auto-actas). Use \`$ACTAS_NAME\` as the FROM (2nd argument) in every send.sh call for the rest of this session; treat inbound messages as addressed to \`$ACTAS_NAME\`. Auto-actas is already in effect — do NOT ask the user to run /agmsg actas."
      ;;
    status=held*)
      # Another live session owns this role. Warn and fall back to broad watcher.
      ACTAS_NOTE="WARNING: cannot auto-act as \`$ACTAS_NAME\` — $claim. The role is held by another live session. Run \`/agmsg drop $ACTAS_NAME\` there first, then \`/agmsg actas $ACTAS_NAME\` here. Watcher started in default (broad) mode for now."
      ;;
    *)
      # not_registered or unexpected — team init probably hasn't run yet.
      ACTAS_NOTE="NOTE: role \`$ACTAS_NAME\` is not registered to a team in this project. Run the matching init first (e.g. claude-devteam-init / claude-design-team-init), then \`/agmsg actas $ACTAS_NAME\`. Watcher started in default (broad) mode."
      ;;
  esac
fi

# Build watch commands (with optional actas name filter).
WATCH_CMD="$WATCH $SESSION_ID $PROJECT $TYPE"
WATCH_ONCE_CMD="$WATCH --once $SESSION_ID $PROJECT $TYPE"
if [ -n "$WATCH_NAME" ]; then
  WATCH_CMD="$WATCH_CMD $WATCH_NAME"
  WATCH_ONCE_CMD="$WATCH_ONCE_CMD $WATCH_NAME"
fi

# Delivery style. Some environments don't offer the Monitor tool at all
# (observed: Claude Code with CLAUDE_CODE_USE_BEDROCK=1 — ToolSearch finds
# no Monitor). Hooks inherit the CLI's environment, so we can autodetect
# that case and fall back to a "background Bash + re-arm" loop driven by
# `watch.sh --once`. AGMSG_DELIVERY_STYLE=monitor|bash-once overrides the
# autodetection in either direction.
STYLE="${AGMSG_DELIVERY_STYLE:-}"
if [ -z "$STYLE" ]; then
  if [ "${CLAUDE_CODE_USE_BEDROCK:-}" = "1" ]; then
    STYLE="bash-once"
  else
    STYLE="monitor"
  fi
fi

if [ "$STYLE" = "bash-once" ]; then
  cat <<EOF
AGMSG monitor mode (Bash fallback — the Monitor tool is not available in
this environment): run the following command NOW with the Bash tool, with
run_in_background: true, before any other action in this session.

  command: $WATCH_ONCE_CMD
  description: agmsg inbox wait (one batch)

The task blocks until agmsg messages arrive, prints them (one line per
message: \`<ts> | <team> | <from> → <to> | <body>\`), then exits. Each time
you are notified that the task completed:
  1. Its output lines are incoming messages — react to them; reply with
     send.sh.
  2. Re-arm based on exit code:
     - exit 0  → messages were delivered. IMMEDIATELY re-arm by running
       the exact same command again with the Bash tool
       (run_in_background: true). A persisted cursor guarantees nothing is
       lost between re-arms.
     - non-zero → the watcher was stopped (killed by a successor, or no
       identities registered). Do NOT re-arm. Check stderr/stdout for the
       reason. Common codes: 130=interrupted, 143=killed by successor
       watcher, 75=no identities registered for this session.

If you later run \`/agmsg actas <name>\`, re-arm with <name> appended
instead: \`$WATCH --once $SESSION_ID $PROJECT $TYPE <name>\`
$ACTAS_NOTE
EOF
  exit 0
fi

cat <<EOF
AGMSG monitor mode: invoke the Monitor tool now with the following parameters,
before any other action in this session.

  command: $WATCH_CMD
  description: agmsg inbox stream
  persistent: true

This streams incoming agmsg messages into the session in real time. Each
output line is one message: \`<ts> | <team> | <from> → <to> | <body>\`.
React to messages as they arrive; reply with \`send.sh\`.

Note: On a /clear or --continue/--resume re-fire, you may shortly see a
"Monitor … stopped" notification for an earlier 'agmsg inbox stream'
task. That is the previous watcher being cleaned up to avoid duplicates
— it is expected. Do NOT relaunch it; the Monitor you invoke from this
directive replaces it.
$ACTAS_NOTE
EOF
