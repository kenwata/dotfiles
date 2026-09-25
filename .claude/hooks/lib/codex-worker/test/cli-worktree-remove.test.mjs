// codex-worker の cli の試験: worktree --remove(--force の有無と記録の状態ごとの扱い)。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  git,
  setup,
  createCleanRecordedWorktree,
} from "./cli-harness.mjs";

test("worktree --remove は removed の 3 欄を返して worktree・ブランチ・記録を消す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");

    const removed = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.equal(removed.json.task, "T7");
    assert.deepEqual(removed.json.removed, { worktree: true, branch: true, record: true });
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), false);
  } finally { t.cleanup(); }
});

test("worktree --remove は dirty worktree と未統合コミットを exit 2 で保持する", () => {
  for (const state of ["dirty", "ahead"]) {
    const t = setup({ workspace: "repo" });
    try {
      const { record, worktreePath } = createCleanRecordedWorktree(t);
      const recordPath = path.join(t.taskDir, "worktree.json");
      if (state === "dirty") {
        fs.writeFileSync(path.join(worktreePath, "untracked.txt"), "untracked\n");
      } else {
        fs.writeFileSync(path.join(worktreePath, "src/a/unmerged.ts"), "unmerged\n");
        git(worktreePath, "add", "src/a/unmerged.ts");
        git(worktreePath, "commit", "-qm", "unmerged commit");
      }

      const refused = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

      assert.equal(refused.code, 2, JSON.stringify(refused.json));
      assert.ok(Array.isArray(refused.json.errors));
      assert.equal(fs.existsSync(worktreePath), true);
      assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
      assert.equal(fs.existsSync(recordPath), true);
    } finally { t.cleanup(); }
  }
});

for (const state of ["repo", "path", "invalid-json"]) {
  test(`worktree --remove --force は ${state} の記録でも計算値を破棄する`, () => {
    const t = setup({ workspace: "repo" });
    try {
      const { record, worktreePath } = createCleanRecordedWorktree(t);
      const recordPath = path.join(t.taskDir, "worktree.json");
      const outsidePath = path.join(t.tmp, "outside-worktree");
      if (state === "repo") {
        fs.writeFileSync(recordPath, JSON.stringify({
          ...record,
          repo: path.join(t.tmp, "deleted-repo"),
        }));
      } else if (state === "path") {
        fs.mkdirSync(outsidePath);
        fs.writeFileSync(path.join(outsidePath, "keep.txt"), "keep\n");
        fs.writeFileSync(recordPath, JSON.stringify({ ...record, path: outsidePath }));
      } else {
        fs.writeFileSync(recordPath, "{\n");
      }

      const removed = t.run([
        "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
      ]);

      assert.equal(removed.code, 0, JSON.stringify(removed.json));
      assert.deepEqual(removed.json.removed, { worktree: true, branch: true, record: true });
      assert.equal(fs.existsSync(worktreePath), false);
      assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
      assert.equal(fs.existsSync(recordPath), false);
      if (state === "path") {
        assert.equal(fs.readFileSync(path.join(outsidePath, "keep.txt"), "utf8"), "keep\n");
      }
    } finally { t.cleanup(); }
  });

  test(`worktree --remove は ${state} の記録で --force 無しなら何も消さない`, () => {
    const t = setup({ workspace: "repo" });
    try {
      const { record, worktreePath } = createCleanRecordedWorktree(t);
      const recordPath = path.join(t.taskDir, "worktree.json");
      const outsidePath = path.join(t.tmp, "outside-worktree");
      if (state === "repo") {
        fs.writeFileSync(recordPath, JSON.stringify({
          ...record,
          repo: path.join(t.tmp, "deleted-repo"),
        }));
      } else if (state === "path") {
        fs.mkdirSync(outsidePath);
        fs.writeFileSync(path.join(outsidePath, "keep.txt"), "keep\n");
        fs.writeFileSync(recordPath, JSON.stringify({ ...record, path: outsidePath }));
      } else {
        fs.writeFileSync(recordPath, "{\n");
      }

      const refused = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

      assert.equal(refused.code, 2, JSON.stringify(refused.json));
      assert.equal(fs.existsSync(worktreePath), true);
      assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
      assert.equal(fs.existsSync(recordPath), true);
      if (state === "path") {
        assert.equal(fs.readFileSync(path.join(outsidePath, "keep.txt"), "utf8"), "keep\n");
      }
    } finally { t.cleanup(); }
  });
}

test("worktree --remove --force は置き場が消えて登録だけ残る状態も worktree を削除済みと報告する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");
    fs.rmSync(worktreePath, { recursive: true, force: true });

    const removed = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.equal(removed.json.removed.worktree, true);
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "worktree", "list", "--porcelain").includes(worktreePath), false);
    assert.equal(fs.existsSync(recordPath), false);
  } finally { t.cleanup(); }
});

test("worktree --remove --force は置き場がシンボリックリンクなら拒否してリンク先を残す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");
    const outsidePath = path.join(t.tmp, "outside-worktree");
    git(t.wsRepo, "worktree", "remove", "--force", worktreePath);
    fs.mkdirSync(outsidePath);
    fs.writeFileSync(path.join(outsidePath, "keep.txt"), "keep\n");
    fs.symlinkSync(outsidePath, worktreePath, "dir");

    const refused = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(refused.code, 2, JSON.stringify(refused.json));
    assert.ok(Array.isArray(refused.json.errors));
    assert.equal(fs.lstatSync(worktreePath).isSymbolicLink(), true);
    assert.equal(fs.readFileSync(path.join(outsidePath, "keep.txt"), "utf8"), "keep\n");
    assert.equal(fs.existsSync(recordPath), true);
  } finally { t.cleanup(); }
});

test("worktree --remove --force は別の場所で checkout 中のブランチを拒否する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");
    const elsewhere = path.join(t.tmp, "elsewhere");
    git(t.wsRepo, "worktree", "remove", "--force", worktreePath);
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, "keep.txt"), "keep\n");
    git(t.wsRepo, "worktree", "add", elsewhere, record.branch);

    const refused = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(refused.code, 2, JSON.stringify(refused.json));
    assert.ok(Array.isArray(refused.json.errors));
    assert.equal(fs.existsSync(elsewhere), true);
    assert.equal(git(elsewhere, "symbolic-ref", "--short", "HEAD").trim(), record.branch);
    assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.readFileSync(path.join(worktreePath, "keep.txt"), "utf8"), "keep\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(recordPath, "utf8")), record);
  } finally { t.cleanup(); }
});

test("worktree --remove --force は本体不明の置き場を消しブランチ未確認の警告を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    git(t.wsRepo, "worktree", "remove", "--force", worktreePath);
    fs.rmSync(path.join(t.taskDir, "worktree.json"));
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, "keep.txt"), "keep\n");

    const removed = t.run([
      "worktree", "--root", t.root, "--task", "T7", "--remove", "--force",
    ]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.equal(removed.json.removed.worktree, true);
    assert.equal(removed.json.removed.branch, false);
    assert.equal(removed.json.removed.record, false);
    assert.deepEqual(removed.json.warnings, [
      "本体リポジトリが見つからず、ブランチを確認できなかった",
    ]);
    assert.equal(fs.existsSync(worktreePath), false);
    assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
  } finally { t.cleanup(); }
});

test("worktree --remove は記録も置き場も無い時に false の report と警告を返す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    git(t.wsRepo, "worktree", "remove", "--force", worktreePath);
    fs.rmSync(path.join(t.taskDir, "worktree.json"));

    const removed = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

    assert.equal(removed.code, 0, JSON.stringify(removed.json));
    assert.deepEqual(removed.json.removed, { worktree: false, branch: false, record: false });
    assert.deepEqual(removed.json.warnings, [
      "本体リポジトリが見つからず、ブランチを確認できなかった",
    ]);
    assert.equal(fs.existsSync(worktreePath), false);
  } finally { t.cleanup(); }
});

test("worktree --remove は本体不明の置き場がある時に exit 2 で保持する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    git(t.wsRepo, "worktree", "remove", "--force", worktreePath);
    fs.rmSync(path.join(t.taskDir, "worktree.json"));
    fs.mkdirSync(worktreePath);
    fs.writeFileSync(path.join(worktreePath, "keep.txt"), "keep\n");

    const refused = t.run(["worktree", "--root", t.root, "--task", "T7", "--remove"]);

    assert.equal(refused.code, 2, JSON.stringify(refused.json));
    assert.ok(Array.isArray(refused.json.errors));
    assert.equal(fs.readFileSync(path.join(worktreePath, "keep.txt"), "utf8"), "keep\n");
    assert.equal(fs.existsSync(path.join(t.taskDir, "worktree.json")), false);
  } finally { t.cleanup(); }
});

test("worktree --force は --remove 無しなら exit 2 で何も消さない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record, worktreePath } = createCleanRecordedWorktree(t);
    const recordPath = path.join(t.taskDir, "worktree.json");

    const refused = t.run(["worktree", "--root", t.root, "--task", "T7", "--force"]);

    assert.equal(refused.code, 2, JSON.stringify(refused.json));
    assert.ok(Array.isArray(refused.json.errors));
    assert.equal(fs.existsSync(worktreePath), true);
    assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.deepEqual(JSON.parse(fs.readFileSync(recordPath, "utf8")), record);
  } finally { t.cleanup(); }
});
