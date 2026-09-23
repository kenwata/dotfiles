// herdr CLI の包み(herdr.mjs): 引数の組み立て、成功と失敗の JSON の読み分け、失敗の種別
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { HerdrError, agentGet, agentPrompt, agentRead, agentWait, available } from "../herdr.mjs";

// 偽の herdr: FAKE_HERDR_MODE で応答を切り替え、受け取った引数を FAKE_HERDR_LOG に残す
const FAKE = `#!/usr/bin/env node
const fs = require("node:fs");
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
const mode = process.env.FAKE_HERDR_MODE || "ok";
if (process.argv[2] === "--version") { console.log("herdr 0.9.1"); process.exit(mode === "broken" ? 1 : 0); }
if (mode === "error") { process.stdout.write(JSON.stringify({ error: { code: "agent_not_found", message: "no such agent" }, id: "x" })); process.exit(1); }
if (mode === "crash") { process.stderr.write("boom"); process.exit(3); }
if (mode === "noagent") { process.stdout.write(JSON.stringify({ id: "x", result: {} })); process.exit(0); }
if (process.argv[3] === "read") { process.stdout.write("line1\\nline2\\n"); process.exit(0); }
process.stdout.write(JSON.stringify({ id: "x", result: { agent: { agent: "claude", agent_status: "idle", agent_session: { value: "s1" } } } }));
`;

function withFake(mode, fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "herdr-fake-"));
  const bin = path.join(base, "herdr");
  fs.writeFileSync(bin, FAKE, { mode: 0o755 });
  const log = path.join(base, "log");
  fs.writeFileSync(log, "");
  const saved = { HERDR_BIN: process.env.HERDR_BIN, HERDR_ENV: process.env.HERDR_ENV, FAKE_HERDR_MODE: process.env.FAKE_HERDR_MODE, FAKE_HERDR_LOG: process.env.FAKE_HERDR_LOG };
  Object.assign(process.env, { HERDR_BIN: bin, HERDR_ENV: "1", FAKE_HERDR_MODE: mode, FAKE_HERDR_LOG: log });
  try {
    return fn(() => fs.readFileSync(log, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)));
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}

test("available は HERDR_ENV=1 かつ herdr --version が通る時だけ真", () => {
  withFake("ok", () => {
    assert.equal(available(), true);
    process.env.HERDR_ENV = "";
    assert.equal(available(), false, "herdr の外");
  });
  withFake("broken", () => assert.equal(available(), false));
});

test("get / prompt / wait は引数をそのまま herdr に渡し、result.agent を返す", () => {
  withFake("ok", (calls) => {
    assert.equal(agentGet("w1:p1").agent_status, "idle");
    agentPrompt("w1:p1", "/clear");
    agentPrompt("w1:p1", "/execute-task T1", { wait: true, timeoutMs: 5000 });
    agentWait("w1:p1", { until: ["idle", "done"], timeoutMs: 30000 });
    assert.deepEqual(calls(), [
      ["agent", "get", "w1:p1"],
      ["agent", "prompt", "w1:p1", "/clear"],
      ["agent", "prompt", "w1:p1", "/execute-task T1", "--wait", "--timeout", "5000"],
      ["agent", "wait", "w1:p1", "--until", "idle", "--until", "done", "--timeout", "30000"],
    ]);
  });
});

test("失敗は種別付きの HerdrError: error.code / 非 0 終了 / 起動失敗 / agent 無し。read の失敗は空文字", () => {
  withFake("error", () => {
    assert.throws(() => agentGet("x"), (e) => e instanceof HerdrError && e.code === "agent_not_found");
    assert.equal(agentRead("x"), "");
  });
  withFake("crash", () => assert.throws(() => agentWait("x"), (e) => e.code === "exit_3" && /boom/.test(e.message)));
  withFake("noagent", () => assert.throws(() => agentGet("x"), (e) => e.code === "no_agent"));
  withFake("ok", () => {
    assert.equal(agentRead("x", 2), "line1\nline2\n");
    process.env.HERDR_BIN = "/nonexistent/herdr";
    assert.throws(() => agentGet("x"), (e) => e.code === "spawn_failed");
  });
});
