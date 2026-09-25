import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { readRollout } from "../core.mjs";

test("readRollout returns effort from turn_context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-rollout-"));
  try {
    const file = path.join(dir, "rollout.jsonl");
    fs.writeFileSync(file, JSON.stringify({ type: "turn_context", payload: { effort: "high" } }));

    assert.equal(readRollout(file).effort, "high");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readRollout returns null when rollout has no turn_context", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-rollout-"));
  try {
    const file = path.join(dir, "rollout.jsonl");
    fs.writeFileSync(file, JSON.stringify({ type: "event_msg", payload: {} }));

    assert.equal(readRollout(file).effort, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readRollout returns null for missing, empty, or non-string turn_context effort", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-rollout-"));
  try {
    const file = path.join(dir, "rollout.jsonl");
    const rows = [
      { type: "turn_context", payload: {} },
      { type: "turn_context", payload: { effort: "" } },
      { type: "turn_context", payload: { effort: 3 } },
    ];
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));

    assert.equal(readRollout(file).effort, null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("readRollout returns the last usable turn_context effort", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-rollout-"));
  try {
    const file = path.join(dir, "rollout.jsonl");
    const rows = [
      { type: "turn_context", payload: { effort: "high" } },
      { type: "turn_context", payload: { effort: "xhigh" } },
      { type: "turn_context", payload: { effort: "" } },
    ];
    fs.writeFileSync(file, rows.map((row) => JSON.stringify(row)).join("\n"));

    assert.equal(readRollout(file).effort, "xhigh");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
