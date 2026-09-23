// 予算の計算(使用量の読み取り・段の判定)と、セッションの状態の読み書き
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readClaudeUsage, readCodexUsage, stageOf, toolResponseTokens, usagePercent } from "../budget.mjs";
import { readConfig, readSession, statuslineFile, sweep, thresholds, updateSession } from "../session-state.mjs";

function withState(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "task-loop-"));
  const saved = { XDG_STATE_HOME: process.env.XDG_STATE_HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  process.env.XDG_STATE_HOME = path.join(base, "state");
  process.env.XDG_CONFIG_HOME = path.join(base, "config");
  try { return fn(base); } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(base, { recursive: true, force: true });
  }
}

const tokenCount = (total, window = 258400) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: total }, model_context_window: window } } });

test("Codex は rollout の最後の token_count を読み、末尾 256KB に無ければ 4MB まで広げる", () => withState((base) => {
  const file = path.join(base, "rollout.jsonl");
  fs.writeFileSync(file, `${tokenCount(1000)}\n${tokenCount(150000)}\n${"x".repeat(300 * 1024)}\n{"type":"response_item"}\n`);
  assert.deepEqual(readCodexUsage(file), { tokens: 150000, window: 258400, source: "rollout" });
  fs.writeFileSync(file, `${"x".repeat(10)}\n`);
  assert.equal(readCodexUsage(file), null, "token_count が無ければ null");
  assert.equal(readCodexUsage(path.join(base, "missing.jsonl")), null);
  assert.equal(readCodexUsage(null), null);
}));

test("Claude は statusline のサイドファイルの current_usage の和を読み、無ければ used_percentage から戻す", () => withState(() => {
  const write = (value) => {
    fs.mkdirSync(path.dirname(statuslineFile("s1")), { recursive: true });
    fs.writeFileSync(statuslineFile("s1"), JSON.stringify(value));
  };
  assert.equal(readClaudeUsage("s1"), null, "サイドファイルが無い");
  write({ context_window_size: 1000000, current_usage: { input_tokens: 5, cache_creation_input_tokens: 95, cache_read_input_tokens: 700000, output_tokens: 9 } });
  assert.deepEqual(readClaudeUsage("s1"), { tokens: 700100, window: 1000000, source: "statusline" });
  write({ context_window_size: 1000000, used_percentage: 42, current_usage: null });
  assert.equal(readClaudeUsage("s1").tokens, 420000);
  write({ used_percentage: 42 });
  assert.equal(readClaudeUsage("s1"), null, "窓の大きさが分からなければ判定しない");
}));

test("段の判定と、ツール出力の概算", () => {
  const limits = { stage1: 70, stage2: 80 };
  assert.deepEqual([69.9, 70, 79.9, 80, 99].map((p) => stageOf(p, limits)), [0, 1, 1, 2, 2]);
  assert.equal(toolResponseTokens("x".repeat(401)), 101);
  assert.equal(toolResponseTokens({ a: 1 }), 2);
  assert.equal(toolResponseTokens(undefined), 0);
  assert.equal(usagePercent({ tokens: 700, window: 1000 }, 55), 75.5);
});

test("閾値は設定ファイルで上書きでき、無ければ既定値(Claude 70/80・Codex 60/70)", () => withState((base) => {
  assert.deepEqual(thresholds("claude"), { stage1: 70, stage2: 80 });
  assert.deepEqual(thresholds("codex"), { stage1: 60, stage2: 70 });
  fs.mkdirSync(path.join(base, "config", "claude-task-loop"), { recursive: true });
  fs.writeFileSync(path.join(base, "config", "claude-task-loop", "config.json"), JSON.stringify({ codex: { stage2: 65 }, retry_max: 3 }));
  assert.deepEqual(thresholds("codex"), { stage1: 60, stage2: 65 });
  assert.equal(readConfig().retry_max, 3);
}));

test("セッションの状態は最上位のキー単位で置き換え、null のキーは消し、古いものは掃除する", () => withState(() => {
  updateSession("a/b", { loop: { task: "T1" }, budget: { stage: 1 } });
  updateSession("a/b", { budget: { stage: 2 } });
  assert.deepEqual(readSession("a/b").loop, { task: "T1" });
  assert.equal(readSession("a/b").budget.stage, 2);
  updateSession("a/b", { budget: null });
  assert.equal("budget" in readSession("a/b"), false);
  assert.deepEqual(readSession("missing"), {});
  updateSession("old", {});
  sweep(1000, Date.now() + 60 * 1000);
  assert.deepEqual(readSession("old"), {});
}));
