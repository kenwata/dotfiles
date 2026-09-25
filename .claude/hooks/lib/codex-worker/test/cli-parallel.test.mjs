// codex-worker の cli の試験: 並列ステップ(run --worktree --parallel)と integrate-step。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  git,
  setup,
  waitFor,
  worklogEntries,
  parallelArgs,
  GIT_IDENTITY,
  stepFile,
} from "./cli-harness.mjs";

test("--parallel は --worktree が無ければ起動前に拒否する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const args = parallelArgs(t, "1", "src/a/impl.ts").filter((a) => a !== "--worktree");

    const { code, json } = t.run(args);

    assert.equal(code, 2, JSON.stringify(json));
    assert.match(json.errors.join(), /--parallel は --worktree/);
  } finally { t.cleanup(); }
});

test("並列ステップは兄弟が走っていても別の worktree で起動し、上限・並列でない run・許可パスの重なりは起動前に拒否する", async () => {
  const t = setup({ workspace: "repo" });
  try {
    t.registerPlan("- s1: a\n- s2: b\n- s3: c\n");
    const pidFile = path.join(t.base, "grandchild.pid");
    const sleepEnv = { FAKE_MODE: "sleep", FAKE_PID_FILE: pidFile };
    const sleeper = t.spawnRun(parallelArgs(t, "1", "src/a/impl.ts"), sleepEnv);
    await waitFor(() => t.locks().length > 0 && fs.existsSync(pidFile));

    const sibling = t.run(parallelArgs(t, "2", "src/a/first.ts"), stepFile("src/a/first.ts"));
    const overlap = t.run(parallelArgs(t, "3", "src/a/impl.ts"));
    const capped = t.run([...parallelArgs(t, "3", "src/a/other.ts"), "--max-parallel", "1"]);
    const serial = t.run(parallelArgs(t, "3", "src/a/other.ts").filter((a) => a !== "--parallel"));
    sleeper.kill("SIGTERM");
    await new Promise((resolve) => sleeper.on("close", resolve));

    assert.equal(sibling.code, 0, JSON.stringify(sibling.json));
    assert.equal(sibling.json.accepted, true);
    assert.match(sibling.json.worktree.branch, /\/T7-s2$/);
    assert.deepEqual(sibling.json.gate.changed, ["src/a/first.ts"]);
    assert.equal(overlap.code, 2);
    assert.match(overlap.json.errors.join(), /許可パスが重なる並列ステップが実行中: ステップ 1/);
    assert.equal(capped.code, 2);
    assert.match(capped.json.errors.join(), /上限 1/);
    assert.equal(serial.code, 2);
    assert.match(serial.json.errors.join(), /別の worker が実行中/);
  } finally { t.cleanup(); }
});

test("integrate-step はコミット済みのステップを T の worktree へ取り込んで片付け、未統合のステップがある間は integrate を拒否する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const stepRun = t.run(parallelArgs(t, "2", "src/a/first.ts"), stepFile("src/a/first.ts"));
    assert.equal(stepRun.code, 0, JSON.stringify(stepRun.json));
    const stepPath = stepRun.json.worktree.path;
    git(stepPath, "add", "-A");
    git(stepPath, "commit", "-qm", "T7 s2");

    const blocked = t.run(["integrate", "--root", t.root, "--task", "T7"]);
    const integrateArgs = ["integrate-step", "--root", t.root, "--task", "T7", "--step", "2"];
    const integrated = t.run(integrateArgs, GIT_IDENTITY);

    assert.equal(blocked.code, 2, JSON.stringify(blocked.json));
    assert.match(blocked.json.errors.join(), /統合していないステップの worktree がある: s2/);
    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.equal(integrated.json.commits, 1);
    const taskRecord = JSON.parse(fs.readFileSync(path.join(t.taskDir, "worktree.json"), "utf8"));
    const integratedFile = fs.readFileSync(path.join(taskRecord.path, "src/a/first.ts"), "utf8");
    assert.equal(integratedFile, "written by a parallel step\n");
    assert.equal(fs.existsSync(stepPath), false);
    assert.ok(worklogEntries(t, "integrate").some((line) => line.includes("step=s2")));
  } finally { t.cleanup(); }
});
