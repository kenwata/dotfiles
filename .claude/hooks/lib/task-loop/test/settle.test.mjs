// settleTick が時刻と待ち状態に応じて settle の判定を行うことを確かめる。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeTurn } from "../session-state.mjs";

process.env.TASK_LOOP_HERDR_GRACE_MS = "1000";
const { initialSettleState, settleTick } = await import("../settle.mjs");
delete process.env.TASK_LOOP_HERDR_GRACE_MS;

const FAKE_HERDR = `#!/usr/bin/env node
const fs = require("node:fs");
const state = JSON.parse(fs.readFileSync(process.env.SETTLE_HERDR_STATE, "utf8"));
if (state.failure) {
  process.stderr.write(JSON.stringify({ error: { code: state.failure, message: state.failure } }));
  process.exit(1);
}
process.stdout.write(JSON.stringify({
  id: "settle-test",
  result: { agent: { agent_status: state.status, agent_session: { value: "session-1" } } },
}));
`;

function withFixture(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "task-loop-settle-"));
  const herdr = path.join(base, "herdr");
  const herdrState = path.join(base, "herdr.json");
  const saved = Object.fromEntries(
    ["HERDR_BIN", "HERDR_ENV", "SETTLE_HERDR_STATE", "XDG_STATE_HOME", "TMPDIR"]
      .map((key) => [key, process.env[key]]),
  );
  fs.writeFileSync(herdr, FAKE_HERDR, { mode: 0o700 });
  fs.writeFileSync(herdrState, JSON.stringify({ status: "idle" }));
  process.env.HERDR_BIN = herdr;
  process.env.HERDR_ENV = "1";
  process.env.SETTLE_HERDR_STATE = herdrState;
  process.env.XDG_STATE_HOME = path.join(base, "state");
  process.env.TMPDIR = path.join(base, "tmp");
  fs.mkdirSync(process.env.TMPDIR);

  const fixture = {
    base,
    root: path.join(base, "root"),
    setHerdr(value) { fs.writeFileSync(herdrState, JSON.stringify(value)); },
    setTurn(turn) { writeTurn("session-1", turn); },
    context(overrides = {}) {
      return {
        target: "test-pane",
        root: this.root,
        settleMs: 10,
        answerTimeoutMs: 10,
        session: "session-1",
        isComplete: () => false,
        log: (text) => this.logs.push(text),
        ...overrides,
      };
    },
    logs: [],
  };
  fs.mkdirSync(fixture.root);
  try {
    fn(fixture);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test(
  "quiet は時刻が止まった周では満了せず、時刻を進めると完了する",
  () => withFixture((fixture) => {
    const ctx = fixture.context();
    const initial = initialSettleState(10_000);
    const first = settleTick(ctx, initial, 100);
    const repeated = settleTick(ctx, first.state, 100);

    assert.deepEqual(first, { wait: true, state: { ...initial, quietSince: 100 } });
    assert.deepEqual(repeated, { wait: true, state: first.state });
    assert.deepEqual(settleTick(ctx, repeated.state, 110), { done: true, state: repeated.state });
    assert.equal(initial.quietSince, null, "入力 state は変更されない");
  }),
);

test(
  "no_evidence は時刻を進めるまで猶予で停止しない",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "unknown" });
    const ctx = fixture.context();
    const initial = initialSettleState(10_000);
    const first = settleTick(ctx, initial, 100);
    const repeated = settleTick(ctx, first.state, 100);

    assert.equal(first.wait, true);
    assert.equal(repeated.wait, true);
    assert.equal(repeated.state.blindSince, 100);
    assert.deepEqual(settleTick(ctx, repeated.state, 1101), {
      stop: "unknown",
      detail: undefined,
      state: repeated.state,
    });
  }),
);

test(
  "制限時間は時刻を進めるまで満了しない",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "working" });
    const ctx = fixture.context();
    const limitState = initialSettleState(100);
    const busy = settleTick(ctx, limitState, 100);
    assert.equal(busy.wait, true);
    assert.equal(settleTick(ctx, busy.state, 100).wait, true);
    assert.deepEqual(settleTick(ctx, busy.state, 101), {
      stop: "timeout",
      detail: undefined,
      state: busy.state,
    });
  }),
);

test(
  "答え待ち上限は時刻を進めるまで満了せず、停止時に累計を含む",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "blocked" });
    const answerCtx = fixture.context({ answerTimeoutMs: 10 });
    const waiting = settleTick(answerCtx, initialSettleState(10_000), 200);

    const repeated = settleTick(answerCtx, waiting.state, 200);
    assert.equal(waiting.wait, true);
    assert.equal(repeated.wait, true);
    assert.equal(repeated.state.answerWaitMs, 0);

    const continued = settleTick(answerCtx, repeated.state, 206);
    assert.equal(continued.wait, true);
    assert.equal(continued.state.answerWaitMs, 6);

    const stopped = settleTick(answerCtx, continued.state, 211);
    assert.equal(stopped.stop, "answer_timeout");
    assert.equal(stopped.state.answerWaitMs, 11);
  }),
);

test(
  "答え待ち時間を制限時間から除き、awaiting_user の周だけ累計する",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "blocked" });
    const ctx = fixture.context({ answerTimeoutMs: 1_000 });
    const initial = initialSettleState(20);
    const started = settleTick(ctx, initial, 10);
    assert.equal(started.state.answerWaitMs, 0);

    const continued = settleTick(ctx, started.state, 40);
    assert.equal(continued.state.limit, 50);
    assert.equal(continued.state.answerWaitMs, 30);
    assert.equal(continued.state.answeredFrom, 40);

    fixture.setHerdr({ status: "idle" });
    const answered = settleTick(ctx, continued.state, 60);
    assert.equal(answered.wait, true);
    assert.equal(answered.state.limit, 70);
    assert.equal(answered.state.answerWaitMs, 30);
    assert.equal(answered.state.answerSince, null);
  }),
);

test(
  "hook が awaiting_user の間は上限が止まり、答え待ち経過を state に累計する",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "idle" });
    fixture.setTurn({ state: "awaiting_user", event: "PreToolUse", at: 200 });
    const ctx = fixture.context({ answerTimeoutMs: 10 });
    const initial = initialSettleState(205);
    const started = settleTick(ctx, initial, 200);
    const repeated = settleTick(ctx, started.state, 200);
    const continued = settleTick(ctx, repeated.state, 206);

    assert.equal(started.wait, true);
    assert.equal(repeated.wait, true, "時刻を止めた周では答え待ち上限が満了しない");
    assert.equal(repeated.state.answerWaitMs, 0);
    assert.equal(continued.wait, true);
    assert.equal(continued.state.limit, 211, "答え待ちの6msだけ制限時間を延ばす");
    assert.equal(continued.state.answerWaitMs, 6);

    fixture.setTurn({ state: "stopped", event: "Stop", at: 207 });
    const answered = settleTick(ctx, continued.state, 207);
    assert.equal(answered.wait, true);
    assert.equal(answered.state.answerWaitMs, 6, "答え待ちでない周は累計を増やさない");
    assert.equal(answered.state.limit, 212);
  }),
);

test(
  "hook が awaiting_user のまま時刻を進めると答え待ち上限で止まる",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "idle" });
    fixture.setTurn({ state: "awaiting_user", event: "PermissionRequest", at: 200 });
    const ctx = fixture.context({ answerTimeoutMs: 10 });
    const waiting = settleTick(ctx, initialSettleState(10_000), 200);
    const repeated = settleTick(ctx, waiting.state, 200);
    const continued = settleTick(ctx, repeated.state, 206);
    const stopped = settleTick(ctx, continued.state, 211);

    assert.equal(repeated.wait, true);
    assert.equal(stopped.stop, "answer_timeout");
    assert.equal(stopped.state.answerWaitMs, 11);
  }),
);

test(
  "herdr が idle でも最近の running hook 記録があれば静かな時間を待つ",
  () => withFixture((fixture) => {
    fixture.setHerdr({ status: "idle" });
    fixture.setTurn({ state: "running", event: "PreToolUse", at: 200 });
    const ctx = fixture.context({ settleMs: 10 });
    const initial = initialSettleState(10_000);
    const first = settleTick(ctx, initial, 200);
    const repeated = settleTick(ctx, first.state, 201);

    assert.equal(first.wait, true);
    assert.equal(repeated.wait, true);
    assert.equal(first.state.quietSince, null);
    assert.equal(repeated.state.quietSince, null);
  }),
);
