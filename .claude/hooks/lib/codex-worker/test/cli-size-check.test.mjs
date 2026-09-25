// run が runner 側の size-check 結果を report と状態行へ反映することを確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { setup, baseArgs, git } from "./cli-harness.mjs";

test("run の行数違反は成果を残したまま report と状態行に載る", () => {
  const t = setup();
  try {
    const args = [...baseArgs(t.root, t.packet), "--max-file-lines", "5"];
    const { code, json, stderr } = t.run(args, { FAKE_MODE: "ok", FAKE_LINES: "6" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.accepted, true);
    assert.deepEqual(json.size_check, {
      ok: false,
      max_file_lines: 5,
      violations: [{ path: "src/a/impl.ts", lines: 6, snapshot_lines: null }],
      warnings: [],
    });
    assert.deepEqual(json.warnings, [
      "ファイルが 5 行を超えた: src/a/impl.ts(6 行、snapshot 時 新規)",
    ]);
    assert.equal(fs.readFileSync(path.join(t.root, "src/a/impl.ts"), "utf8"), "line\n".repeat(6));
    assert.match(stderr, /finished: accepted worker=done changed=1/);
    assert.match(stderr, /timing:[^\n]* size=NG/);
    assert.match(fs.readFileSync(path.join(json.run_dir, "prompt.md"), "utf8"), /--max-file-lines 5/);
  } finally { t.cleanup(); }
});

test("既存の巨大ファイルが増えた警告は report に載るが状態行を NG にしない", () => {
  const t = setup();
  try {
    fs.writeFileSync(path.join(t.root, "src/a/impl.ts"), "old\n".repeat(6));
    git(t.root, "add", "src/a/impl.ts");
    git(t.root, "commit", "-qm", "oversized baseline");
    const args = [...baseArgs(t.root, t.packet), "--max-file-lines", "5"];
    const { code, json, stderr } = t.run(args, { FAKE_MODE: "ok", FAKE_LINES: "7" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.accepted, true);
    assert.equal(json.size_check.ok, true);
    assert.deepEqual(json.size_check.warnings, [
      { path: "src/a/impl.ts", lines: 7, snapshot_lines: 6 },
    ]);
    assert.deepEqual(json.warnings, [
      "ファイルが 5 行を超えた: src/a/impl.ts(7 行、snapshot 時 6)",
    ]);
    assert.match(stderr, /finished: accepted worker=done changed=1/);
    assert.doesNotMatch(stderr, /size=NG/);
  } finally { t.cleanup(); }
});

test("不正な --max-file-lines は起動前に拒否し size_check を出さない", () => {
  const t = setup();
  try {
    const result = t.run([...baseArgs(t.root, t.packet), "--max-file-lines", "0"]);

    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /--max-file-lines は正の整数/);
    assert.equal(Object.hasOwn(result.json, "size_check"), false);
    assert.equal(t.execEnv(), null, "worker を起動しない");
  } finally { t.cleanup(); }
});
