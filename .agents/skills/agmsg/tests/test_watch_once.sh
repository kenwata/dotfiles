#!/usr/bin/env bash
# Behavior tests for `watch.sh --once` delivery (exit-after-batch, cursor
# persistence across the re-arm gap, no history replay, active-name filter).
#
# Hermetic: each test copies scripts/ into a throwaway sandbox with its own
# teams/, run/ and message store (AGMSG_STORAGE_PATH), so the real skill
# state — team registrations, actas locks, message DB — is never touched.
#
# Run: bash tests/test_watch_once.sh
set -u

SKILL_SRC="$(cd "$(dirname "$0")/.." && pwd)"
PASS=0
FAIL=0

note_pass() { echo "    ok: $1"; PASS=$((PASS + 1)); }
note_fail() { echo "    FAIL: $1"; FAIL=$((FAIL + 1)); }

# Arrange a sandbox skill clone. Sets SANDBOX, PROJ, WATCH, SEND and exports
# AGMSG_STORAGE_PATH / AGMSG_WATCH_INTERVAL for everything run inside it.
setup_sandbox() {
  SANDBOX="$(mktemp -d /tmp/agmsg-watch-test.XXXXXX)"
  cp -R "$SKILL_SRC/scripts" "$SANDBOX/scripts"
  PROJ="$SANDBOX/proj"
  mkdir -p "$PROJ" "$SANDBOX/teams/testteam"
  cat > "$SANDBOX/teams/testteam/config.json" <<EOF
{"name":"testteam","agents":{
  "alice":{"registrations":[{"type":"claude-code","project":"$PROJ"}]},
  "bob":{"registrations":[{"type":"claude-code","project":"$PROJ"}]}}}
EOF
  export AGMSG_STORAGE_PATH="$SANDBOX/store"
  # 1s poll keeps the suite fast while still exercising the real loop.
  export AGMSG_WATCH_INTERVAL=1
  WATCH="$SANDBOX/scripts/watch.sh"
  SEND="$SANDBOX/scripts/send.sh"
  bash "$SANDBOX/scripts/init-db.sh" >/dev/null
}

teardown_sandbox() {
  # Reap any watcher that a failed assertion left behind.
  pkill -f "$SANDBOX/scripts/watch.sh" 2>/dev/null
  rm -rf "$SANDBOX"
  unset AGMSG_STORAGE_PATH
}

# Wait up to $2 seconds for pid $1 to exit. Echoes "exited" or "running".
wait_pid() {
  local pid="$1" deadline=$(( $(date +%s) + $2 ))
  while kill -0 "$pid" 2>/dev/null; do
    [ "$(date +%s)" -ge "$deadline" ] && { echo running; return; }
    sleep 0.2
  done
  echo exited
}

test_once_delivers_batch_then_exits_zero() {
  echo "  test_once_delivers_batch_then_exits_zero"
  setup_sandbox
  local out="$SANDBOX/out.txt"

  "$WATCH" --once sess-1 "$PROJ" claude-code > "$out" 2>/dev/null &
  local wpid=$!
  sleep 1.5  # let the watcher baseline before the message exists
  "$SEND" testteam alice bob "hello-once" >/dev/null

  local state rc
  state=$(wait_pid "$wpid" 10)
  wait "$wpid" 2>/dev/null
  rc=$?

  if [ "$state" = exited ] && [ "$rc" -eq 0 ]; then
    note_pass "exits 0 after first batch"
  else
    note_fail "expected exit 0 after batch (state=$state rc=$rc)"
  fi
  if grep -qF "| testteam | alice → bob | hello-once" "$out"; then
    note_pass "emits the one-line message format"
  else
    note_fail "missing formatted message line: $(cat "$out")"
  fi
  teardown_sandbox
}

test_cursor_survives_rearm_gap() {
  echo "  test_cursor_survives_rearm_gap"
  setup_sandbox
  local out1="$SANDBOX/out1.txt" out2="$SANDBOX/out2.txt"

  "$WATCH" --once sess-2 "$PROJ" claude-code > "$out1" 2>/dev/null &
  local wpid=$!
  sleep 1.5
  "$SEND" testteam alice bob "msg-1" >/dev/null
  wait_pid "$wpid" 10 >/dev/null

  # No watcher is running now — this is the re-arm gap.
  "$SEND" testteam alice bob "msg-2" >/dev/null

  "$WATCH" --once sess-2 "$PROJ" claude-code > "$out2" 2>/dev/null &
  wpid=$!
  local state
  state=$(wait_pid "$wpid" 10)

  if [ "$state" = exited ] && grep -qF "msg-2" "$out2"; then
    note_pass "message sent during the gap is delivered by the next run"
  else
    note_fail "gap message lost (state=$state out2=$(cat "$out2"))"
  fi
  if grep -qF "msg-1" "$out2"; then
    note_fail "already-delivered message replayed on re-arm"
  else
    note_pass "no duplicate delivery of the previous batch"
  fi
  teardown_sandbox
}

test_no_replay_of_history_on_first_start() {
  echo "  test_no_replay_of_history_on_first_start"
  setup_sandbox
  local out="$SANDBOX/out.txt"

  "$SEND" testteam alice bob "old-msg" >/dev/null

  "$WATCH" --once sess-3 "$PROJ" claude-code > "$out" 2>/dev/null &
  local wpid=$!
  sleep 3  # at least two poll cycles

  if kill -0 "$wpid" 2>/dev/null && [ ! -s "$out" ]; then
    note_pass "stays blocked instead of replaying history"
  else
    note_fail "history replayed or watcher exited early: $(cat "$out")"
  fi

  "$SEND" testteam alice bob "new-msg" >/dev/null
  wait_pid "$wpid" 10 >/dev/null
  if grep -qF "new-msg" "$out" && ! grep -qF "old-msg" "$out"; then
    note_pass "delivers only what arrives after start"
  else
    note_fail "wrong delivery set: $(cat "$out")"
  fi
  teardown_sandbox
}

test_active_name_narrows_subscription() {
  echo "  test_active_name_narrows_subscription"
  setup_sandbox
  local out="$SANDBOX/out.txt"

  "$WATCH" --once sess-4 "$PROJ" claude-code bob > "$out" 2>/dev/null &
  local wpid=$!
  sleep 1.5
  "$SEND" testteam bob alice "for-alice" >/dev/null
  sleep 1.5  # give a full poll cycle the chance to mis-deliver
  "$SEND" testteam alice bob "for-bob" >/dev/null
  wait_pid "$wpid" 10 >/dev/null

  if grep -qF "for-bob" "$out" && ! grep -qF "for-alice" "$out"; then
    note_pass "delivers only the active role's messages"
  else
    note_fail "filter leaked: $(cat "$out")"
  fi
  teardown_sandbox
}

echo "watch.sh --once tests"
test_once_delivers_batch_then_exits_zero
test_cursor_survives_rearm_gap
test_no_replay_of_history_on_first_start
test_active_name_narrows_subscription

echo
echo "passed=$PASS failed=$FAIL"
[ "$FAIL" -eq 0 ]
