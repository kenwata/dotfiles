// レーン設定と、レーン実行の状態置き場
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { laneWorktreePath, readConfig, rootKey, runRecordPath } from "../session-state.mjs";

function withState(fn) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "task-loop-"));
  const saved = {
    XDG_STATE_HOME: process.env.XDG_STATE_HOME,
    XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
  };
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

test("readConfig は正の整数 lanes を数値で返し、それ以外は null", () => withState((base) => {
  assert.equal(readConfig().lanes, null);
  const configDir = path.join(base, "config", "claude-task-loop");
  fs.mkdirSync(configDir, { recursive: true });
  const file = path.join(configDir, "config.json");
  const cases = [
    [3, 3], ["3", 3], [1, 1], [null, null], [0, null], [-1, null], [1.5, null],
    ["bad", null], [true, null],
  ];
  for (const [value, expected] of cases) {
    fs.writeFileSync(file, JSON.stringify({ lanes: value, retry_max: "4" }));
    assert.equal(readConfig().lanes, expected, `lanes=${JSON.stringify(value)}`);
    assert.equal(readConfig().retry_max, 4);
  }
}));

test("レーンのパスは状態ディレクトリと canonical root から決定する", () => withState((base) => {
  const root = path.join(base, "projects", "alpha");
  fs.mkdirSync(root, { recursive: true });
  const alias = path.join(base, "alpha-link");
  fs.symlinkSync(root, alias, "dir");
  const expectedKey = createHash("sha1").update(fs.realpathSync(root)).digest("hex").slice(0, 8);
  const expectedBase = path.join(base, "state", "claude-task-loop");

  assert.equal(rootKey(root), expectedKey);
  assert.equal(rootKey(alias), expectedKey);
  assert.equal(
    laneWorktreePath(alias, "T7"),
    path.join(expectedBase, "worktrees", `alpha-${expectedKey}`, "T7"),
  );
  assert.equal(laneWorktreePath(root, "T7"), laneWorktreePath(root, "T7"));
  assert.equal(fs.existsSync(expectedBase), false, "パス関数はディレクトリを作らない");
}));

test("laneWorktreePath は T<n> 以外を拒否する", () => withState((base) => {
  for (const task of ["T", "t1", "T0/../x", 1]) {
    assert.throws(() => laneWorktreePath(base, task), {
      name: "RangeError",
      message: new RegExp(String(task)),
    });
  }
}));

test("runRecordPath はローカル時刻の秒精度と状態ディレクトリを使う", () => withState((base) => {
  const root = path.join(base, "project-name");
  fs.mkdirSync(root);
  const startedAt = new Date(2026, 8, 25, 9, 33, 38, 987).getTime();
  const key = createHash("sha1").update(fs.realpathSync(root)).digest("hex").slice(0, 8);
  const expected = path.join(
    base,
    "state",
    "claude-task-loop",
    "runs",
    `project-name-${key}-20260925T093338.json`,
  );

  assert.equal(runRecordPath(root, startedAt), expected);
  assert.equal(runRecordPath(root, startedAt), runRecordPath(root, startedAt));
  assert.equal(
    fs.existsSync(path.dirname(expected)),
    false,
    "パス関数はディレクトリを作らない",
  );
  for (const invalid of [NaN, Infinity, -Infinity, "1000"]) {
    assert.throws(() => runRecordPath(root, invalid), { name: "RangeError" });
  }
}));

test("runRecordPath は 1 桁の日時要素をゼロ埋めする", () => withState((base) => {
  const root = path.join(base, "project-name");
  fs.mkdirSync(root);
  const startedAt = new Date(2026, 0, 2, 3, 4, 5).getTime();
  const key = createHash("sha1").update(fs.realpathSync(root)).digest("hex").slice(0, 8);

  assert.equal(
    runRecordPath(root, startedAt),
    path.join(
      base,
      "state",
      "claude-task-loop",
      "runs",
      `project-name-${key}-20260102T030405.json`,
    ),
  );
}));
