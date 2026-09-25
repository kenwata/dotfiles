// codex-worker の cli の試験: worktree --json・show・resume の worktree 欄、作業場所が消えた run、統合の後始末の失敗。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  git,
  setup,
  wsArgs,
  createCleanRecordedWorktree,
} from "./cli-harness.mjs";

test("worktree --json は記録した worktree の 7 欄を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const status = t.run(["worktree", "--root", t.root, "--task", "T7", "--json"]);

    assert.equal(status.code, 0, JSON.stringify(status.json));
    assert.equal(status.json.task, "T7");
    assert.deepEqual(Object.keys(status.json.worktree).sort(), [
      "ahead", "base_ref", "behind", "branch", "dirty", "exists", "path",
    ]);
    assert.deepEqual(status.json.worktree, {
      path: fs.realpathSync(worktreePath),
      branch: record.branch,
      base_ref: record.base_ref,
      exists: true,
      dirty: false,
      ahead: 0,
      behind: 0,
    });

    fs.writeFileSync(path.join(worktreePath, "src/a/impl.ts"), "worktree change\n");
    git(worktreePath, "add", "src/a/impl.ts");
    git(worktreePath, "commit", "-qm", "worktree change");
    const advanced = t.run(["worktree", "--root", t.root, "--task", "T7"]);

    assert.equal(advanced.code, 0, JSON.stringify(advanced.json));
    assert.equal(advanced.json.worktree.ahead, 1);
  } finally { t.cleanup(); }
});

test("worktree --json は JSON でない記録に exit 2 と errors を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    createCleanRecordedWorktree(t);
    fs.writeFileSync(path.join(t.taskDir, "worktree.json"), "not json\n");

    const status = t.run(["worktree", "--root", t.root, "--task", "T7", "--json"]);

    assert.equal(status.code, 2);
    assert.ok(Array.isArray(status.json.errors));
    assert.equal(status.json.errors.length > 0, true);
  } finally { t.cleanup(); }
});

test("worktree --json は repo が存在しない記録に exit 2 と errors を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record } = createCleanRecordedWorktree(t);
    fs.writeFileSync(
      path.join(t.taskDir, "worktree.json"),
      `${JSON.stringify({ ...record, repo: path.join(t.tmp, "deleted-repo") }, null, 2)}\n`,
    );

    const status = t.run(["worktree", "--root", t.root, "--task", "T7", "--json"]);

    assert.equal(status.code, 2);
    assert.ok(Array.isArray(status.json.errors));
    assert.equal(status.json.errors.length > 0, true);
  } finally { t.cleanup(); }
});

test("show --json と resume は記録がある T だけ worktree の 7 欄を最後に返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const absentShown = t.run(["show", "--root", t.root, "--task", "T7", "--json"]);
    const absentResume = t.run(["resume", "--root", t.root, "--task", "T7"]);

    assert.equal(Object.hasOwn(absentShown.json, "worktree"), false);
    assert.equal(Object.hasOwn(absentResume.json, "worktree"), false);

    const { worktreePath } = createCleanRecordedWorktree(t);
    const shown = t.run(["show", "--root", t.root, "--task", "T7", "--json"]);
    const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);

    for (const result of [shown, resumed]) {
      assert.equal(result.code, 0, JSON.stringify(result.json));
      assert.deepEqual(Object.keys(result.json.worktree).sort(), [
        "ahead", "base_ref", "behind", "branch", "dirty", "exists", "path",
      ]);
      assert.equal(result.json.worktree.path, fs.realpathSync(worktreePath));
      assert.equal(Object.keys(result.json).at(-1), "worktree");
    }

  } finally { t.cleanup(); }
});

test("show --json と resume は読めない worktree 記録を error にし resume の unexplained_dirty に含めない", () => {
  for (const unreadable of ["invalid-json", "missing-repo"]) {
    const t = setup({ workspace: "repo" });
    try {
      const { record } = createCleanRecordedWorktree(t);
      const recordPath = path.join(t.taskDir, "worktree.json");
      if (unreadable === "invalid-json") {
        fs.writeFileSync(recordPath, "not json\n");
      } else {
        fs.writeFileSync(
          recordPath,
          `${JSON.stringify({ ...record, repo: path.join(t.tmp, "deleted-repo") }, null, 2)}\n`,
        );
      }

      const worktree = t.run(["worktree", "--root", t.root, "--task", "T7", "--json"]);
      const shown = t.run(["show", "--root", t.root, "--task", "T7", "--json"]);
      const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);

      assert.equal(worktree.code, 2);
      assert.equal(shown.code, 0);
      assert.equal(resumed.code, 0);
      assert.match(shown.json.worktree.error, /.+/);
      assert.match(resumed.json.worktree.error, /.+/);
      assert.equal(Object.keys(shown.json).at(-1), "worktree");
      assert.equal(Object.keys(resumed.json).at(-1), "worktree");
      assert.equal(resumed.json.unexplained_dirty.some((item) => item.includes("worktree")), false);
    } finally { t.cleanup(); }
  }
});

test("resume は統合済みで記録も作業場所も無い worktree を removed として返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
    git(t.wsRepo, "add", "src/a/fixture.ts");
    git(t.wsRepo, "commit", "-qm", "track workspace target");
    const ran = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });
    assert.equal(ran.code, 0, JSON.stringify(ran.json));
    const record = JSON.parse(fs.readFileSync(path.join(t.taskDir, "worktree.json"), "utf8"));
    const worktreePath = fs.realpathSync(record.path);
    git(worktreePath, "add", "src/a/impl.ts");
    git(worktreePath, "commit", "-qm", "supervisor commit");

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);
    const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.equal(resumed.code, 0, JSON.stringify(resumed.json));
    assert.ok(resumed.json.workspaces.some((workspace) =>
      workspace.workspace === worktreePath
      && workspace.dirty.length === 0
      && workspace.unexplained_dirty.length === 0
      && workspace.removed === true
      && !Object.hasOwn(workspace, "error")));
    assert.equal(resumed.json.unexplained_dirty.includes(worktreePath), false);
  } finally { t.cleanup(); }
});

test("作業場所が消えた run の verify と restore は exit 2 で errors を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
    git(t.wsRepo, "add", "src/a/fixture.ts");
    git(t.wsRepo, "commit", "-qm", "track workspace target");
    const ran = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });
    assert.equal(ran.code, 0, JSON.stringify(ran.json));
    const runDir = ran.json.run_dir;
    const snapshot = JSON.parse(fs.readFileSync(path.join(runDir, "snapshot.json"), "utf8"));
    const worktreePath = snapshot.root;
    git(worktreePath, "add", "src/a/impl.ts");
    git(worktreePath, "commit", "-qm", "supervisor commit");

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.equal(fs.existsSync(worktreePath), false);
    const verify = t.run(["verify", "--run", runDir]);
    const statusBeforeRestore = git(t.wsRepo, "status", "--porcelain");
    const headBeforeRestore = git(t.wsRepo, "rev-parse", "HEAD").trim();
    const restore = t.run(["restore", "--run", runDir]);

    assert.equal(verify.code, 2, JSON.stringify(verify.json));
    assert.ok(Array.isArray(verify.json.errors));
    assert.ok(verify.json.errors.some((error) =>
      error.includes(worktreePath) && error.includes("作業場所がもう無い")));
    assert.equal(restore.code, 2, JSON.stringify(restore.json));
    assert.ok(Array.isArray(restore.json.errors));
    assert.ok(restore.json.errors.some((error) =>
      error.includes(worktreePath) && error.includes("作業場所がもう無い")));
    assert.equal(git(t.wsRepo, "status", "--porcelain"), statusBeforeRestore);
    assert.equal(git(t.wsRepo, "rev-parse", "HEAD").trim(), headBeforeRestore);
  } finally { t.cleanup(); }
});

test("integrate の worktree remove 失敗は残るブランチと記録も伝える", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
    git(t.wsRepo, "add", "src/a/fixture.ts");
    git(t.wsRepo, "commit", "-qm", "track workspace target");
    const ran = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });
    assert.equal(ran.code, 0, JSON.stringify(ran.json));
    const recordPath = path.join(t.taskDir, "worktree.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    git(record.path, "add", "src/a/impl.ts");
    git(record.path, "commit", "-qm", "supervisor commit");
    git(t.wsRepo, "worktree", "lock", record.path);

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.ok(integrated.json.cleanup_errors.some((error) => error.includes(record.branch)));
    assert.ok(integrated.json.cleanup_errors.some((error) => error.includes(recordPath)));
  } finally { t.cleanup(); }
});
