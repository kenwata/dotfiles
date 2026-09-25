// codex-worker の cli の試験: worktree --remove と git のロック・worker のロック、後始末の失敗からの復旧。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  cli,
  git,
  setup,
  wsArgs,
  createCleanRecordedWorktree,
  writeLiveWorkerLock,
} from "./cli-harness.mjs";

test("worktree --remove はロックされた worktree を exit 2 で保持する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");
    git(t.wsRepo, "worktree", "lock", worktreePath);

    const refused = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

    assert.equal(refused.code, 2, JSON.stringify(refused.json));
    assert.ok(Array.isArray(refused.json.errors));
    assert.equal(fs.existsSync(worktreePath), true);
    assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), true);
  } finally { t.cleanup(); }
});

test("worktree --remove --force はロックされた worktree を削除する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");
    git(t.wsRepo, "worktree", "lock", worktreePath);

    const removed = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.deepEqual(removed.json.removed, { worktree: true, branch: true, record: true });
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), false);
  } finally { t.cleanup(); }
});

test("integrate の後始末失敗の復旧コマンドで worktree・ブランチ・記録を消す", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
    git(t.wsRepo, "add", "src/a/fixture.ts");
    git(t.wsRepo, "commit", "-qm", "track workspace target");
    const ran = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });
    assert.equal(ran.code, 0, JSON.stringify(ran.json));

    const recordPath = path.join(t.taskDir, "worktree.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const worktreePath = fs.realpathSync(record.path);
    git(worktreePath, "add", "src/a/impl.ts");
    git(worktreePath, "commit", "-qm", "supervisor commit");
    git(t.wsRepo, "worktree", "lock", worktreePath);

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.ok(Array.isArray(integrated.json.cleanup_errors));
    assert.ok(integrated.json.cleanup_errors.some((error) =>
      error.includes(`node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree --root ${t.root}`)
        && error.includes("--task T7 --remove --force")));
    assert.equal(fs.existsSync(worktreePath), true);
    assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), true);

    const removed = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.deepEqual(removed.json.removed, { worktree: true, branch: true, record: true });
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), false);
  } finally { t.cleanup(); }
});

for (const side of ["worktree", "本体"]) {
  for (const force of [false, true]) {
    test(`worktree --remove${force ? " --force" : ""} は${side}の生きている worker ロックで拒否する`, () => {
      const t = setup({ workspace: "repo" });
      try {
        const { record, worktreePath } = createCleanRecordedWorktree(t);
        const recordPath = path.join(t.taskDir, "worktree.json");
        writeLiveWorkerLock(t, side === "worktree" ? worktreePath : t.wsRepo);
        const args = ["worktree", "--root", t.root, "--task", "T7", "--remove"];
        if (force) args.push("--force");

        const refused = t.run(args);

        assert.equal(refused.code, 2, JSON.stringify(refused.json));
        assert.ok(Array.isArray(refused.json.errors));
        assert.ok(refused.json.errors.some((error) => error.includes("別の worker が実行中")));
        assert.equal(fs.existsSync(worktreePath), true);
        assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
        assert.equal(fs.existsSync(recordPath), true);
      } finally { t.cleanup(); }
    });
  }
}

for (const state of ["dirty", "ahead"]) {
  test(`worktree --remove --force は正常な記録の ${state} worktree を削除する`, () => {
    const t = setup({ workspace: "repo" });
    try {
      const { record, worktreePath } = createCleanRecordedWorktree(t);
      const recordPath = path.join(t.taskDir, "worktree.json");
      const headBefore = git(t.wsRepo, "rev-parse", "HEAD").trim();
      if (state === "dirty") {
        fs.writeFileSync(path.join(worktreePath, "untracked.txt"), "untracked\n");
      } else {
        fs.writeFileSync(path.join(worktreePath, "src/a/unmerged.ts"), "unmerged\n");
        git(worktreePath, "add", "src/a/unmerged.ts");
        git(worktreePath, "commit", "-qm", "unmerged commit");
      }

      const removed = t.run([
        "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
      ]);

      assert.equal(removed.code, 0, JSON.stringify(removed.json));
      assert.deepEqual(removed.json.removed, { worktree: true, branch: true, record: true });
      assert.equal(fs.existsSync(worktreePath), false);
      assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
      assert.equal(fs.existsSync(recordPath), false);
      assert.equal(git(t.wsRepo, "rev-parse", "HEAD").trim(), headBefore);
    } finally { t.cleanup(); }
  });
}
