// ターンの状態(hook の入力からの読み取り・ループの待ち方の分類)と、それを書く hook の入口
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STALE_RUNNING_MS, turnFromHook, waitPhase } from "../turn.mjs";
import { clearTurn, readTurn, sweep, turnFile, writeTurn } from "../session-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const hookEntry = path.join(here, "..", "..", "..", "loop-turn.mjs");
const hookWrapper = path.join(here, "..", "..", "..", "loop-turn.sh");
const NOW = 1_700_000_000_000;

test("turnFromHook は依頼の受付とツールの実行後を running にする", () => {
  for (const name of ["UserPromptSubmit", "PostToolUse", "PostToolUseFailure"]) {
    assert.deepEqual(turnFromHook({ hook_event_name: name, tool_name: "Bash" }, NOW), { state: "running", event: name, at: NOW }, name);
  }
});

test("turnFromHook は AskUserQuestion の直前と許可の確認を awaiting_user にし、他のツールの直前は記録しない", () => {
  assert.deepEqual(turnFromHook({ hook_event_name: "PreToolUse", tool_name: "AskUserQuestion" }, NOW), { state: "awaiting_user", event: "PreToolUse", at: NOW });
  assert.deepEqual(turnFromHook({ hook_event_name: "PermissionRequest", tool_name: "Bash" }, NOW), { state: "awaiting_user", event: "PermissionRequest", at: NOW });
  assert.equal(turnFromHook({ hook_event_name: "PreToolUse", tool_name: "Bash" }, NOW), null);
});

test("turnFromHook は Stop と StopFailure を stopped にする", () => {
  for (const name of ["Stop", "StopFailure"]) {
    assert.deepEqual(turnFromHook({ hook_event_name: name }, NOW), { state: "stopped", event: name, at: NOW }, name);
  }
});

test("turnFromHook はサブエージェントの発火と、扱わない event・空の入力を記録しない", () => {
  assert.equal(turnFromHook({ hook_event_name: "PostToolUse", agent_id: "a1" }, NOW), null);
  assert.equal(turnFromHook({ hook_event_name: "SessionStart" }, NOW), null);
  assert.equal(turnFromHook({}, NOW), null);
});

test("waitPhase は herdr の blocked と、herdr が作業中でない時の hook の awaiting_user を答え待ちにする", () => {
  assert.equal(waitPhase("blocked", null, NOW), "awaiting_user");
  assert.equal(waitPhase("blocked", { state: "running", at: NOW }, NOW), "awaiting_user");
  assert.equal(waitPhase("idle", { state: "awaiting_user", at: NOW }, NOW), "awaiting_user");
  assert.equal(waitPhase("idle", { state: "awaiting_user", at: NOW - 10 * STALE_RUNNING_MS }, NOW), "awaiting_user");
});

test("waitPhase は herdr が working なら hook の awaiting_user より作業中を優先する(許可後の実行・拒否された問いの直後)", () => {
  assert.equal(waitPhase("working", { state: "awaiting_user", at: NOW }, NOW), "busy");
  assert.equal(waitPhase("working", { state: "stopped", at: NOW }, NOW), "busy");
});

test("waitPhase は herdr が idle でも hook が running なら busy にする(画面に出ない待ちを取りこぼさない)", () => {
  assert.equal(waitPhase("idle", { state: "running", at: NOW }, NOW), "busy");
  assert.equal(waitPhase("done", { state: "running", at: NOW - STALE_RUNNING_MS + 1 }, NOW), "busy");
});

test("waitPhase は hook の running が STALE_RUNNING_MS より古ければ、中断で取り残された記録とみなして quiet にする", () => {
  assert.equal(waitPhase("idle", { state: "running", at: NOW - STALE_RUNNING_MS }, NOW), "quiet");
});

test("waitPhase は hook が stopped で herdr も入力待ちなら quiet、hook の記録が無ければ herdr だけで決める", () => {
  assert.equal(waitPhase("idle", { state: "stopped", at: NOW }, NOW), "quiet");
  assert.equal(waitPhase("idle", null, NOW), "quiet");
  assert.equal(waitPhase("done", undefined, NOW), "quiet");
  assert.equal(waitPhase("working", null, NOW), "busy");
});

// XDG_STATE_HOME を一時ディレクトリへ向けて fn を実行する
function withStateHome(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "loop-turn-state-"));
  const saved = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = path.join(base, "state");
  try { return fn(base); } finally {
    if (saved === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("writeTurn・readTurn・clearTurn はセッションごとの専用ファイルを読み書きし、無ければ null を返す", () => {
  withStateHome(() => {
    assert.equal(readTurn("s1"), null);

    writeTurn("s1", { state: "running", event: "Stop", at: NOW });
    const written = readTurn("s1");
    clearTurn("s1");
    clearTurn("s1");

    assert.deepEqual(written, { state: "running", event: "Stop", at: NOW });
    assert.equal(readTurn("s1"), null);
  });
});

test("sweep は古いターンの状態ファイルも消す", () => {
  withStateHome(() => {
    writeTurn("old", { state: "stopped", at: NOW });

    sweep(0, Date.now() + 1000);

    assert.equal(fs.existsSync(turnFile("old")), false);
  });
});

// hook の入口を、ループが書いた状態ファイルのある/無いセッションで動かす
function withSessionDir(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "loop-turn-"));
  const sessions = path.join(base, "state", "claude-task-loop", "sessions");
  fs.mkdirSync(sessions, { recursive: true });
  const run = (cmd, input) => spawnSync(cmd[0], [...cmd.slice(1)], {
    input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, XDG_STATE_HOME: path.join(base, "state") },
  });
  const turns = path.join(base, "state", "claude-task-loop", "turns");
  const read = (id) => JSON.parse(fs.readFileSync(path.join(sessions, `${id}.json`), "utf8"));
  const readTurnFile = (id) => JSON.parse(fs.readFileSync(path.join(turns, `${id}.json`), "utf8"));
  try { return fn({ sessions, turns, run, read, readTurnFile }); } finally { fs.rmSync(base, { recursive: true, force: true }); }
}

test("hook の入口はループが駆動するセッションのターンの状態を専用ファイルに書き、ループの状態ファイルには触れない", () => {
  withSessionDir(({ sessions, run, read, readTurnFile }) => {
    fs.writeFileSync(path.join(sessions, "s1.json"), JSON.stringify({ session_id: "s1", loop: { task: "T1" } }));

    const result = run(["node", hookEntry], { hook_event_name: "PreToolUse", tool_name: "AskUserQuestion", session_id: "s1" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, "");
    assert.equal(readTurnFile("s1").state, "awaiting_user");
    assert.deepEqual(read("s1"), { session_id: "s1", loop: { task: "T1" } });
  });
});

test("hook の入口はループの状態ファイルが無い・loop が無いセッションでは何も書かない", () => {
  withSessionDir(({ sessions, turns, run }) => {
    fs.writeFileSync(path.join(sessions, "s2.json"), JSON.stringify({ session_id: "s2", budget: { stage: 1 } }));

    for (const cmd of [["node", hookEntry], ["bash", hookWrapper]]) {
      assert.equal(run(cmd, { hook_event_name: "Stop", session_id: "s3" }).status, 0);
      assert.equal(run(cmd, { hook_event_name: "Stop", session_id: "s2" }).status, 0);
    }

    assert.equal(fs.existsSync(path.join(sessions, "s3.json")), false);
    assert.equal(fs.existsSync(turns), false);
  });
});

test("hook の起動ラッパーはループが駆動するセッションだけ入口へ渡す", () => {
  withSessionDir(({ sessions, run, readTurnFile }) => {
    fs.writeFileSync(path.join(sessions, "s4.json"), JSON.stringify({ session_id: "s4", loop: { task: "T1" } }));

    const result = run(["bash", hookWrapper], { hook_event_name: "Stop", session_id: "s4" });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(readTurnFile("s4").state, "stopped");
  });
});

test("hook の入口は JSON として読めない入力を記録せず、理由を stderr に書いて exit 0 で抜ける", () => {
  withSessionDir(({ turns }) => {
    const result = spawnSync("node", [hookEntry], { input: "not json", encoding: "utf8" });

    assert.equal(result.status, 0);
    assert.match(result.stderr, /loop-turn: /);
    assert.equal(fs.existsSync(turns), false);
  });
});
