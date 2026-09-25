// codex-worker の cli の試験: integrate が本体を変えずに拒否する場合。
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
  worklogEntries,
  createCleanRecordedWorktree,
  writeLiveWorkerLock,
  assertIntegrationRefusalLeavesMainUnchanged,
  assertIntegrationFailureLeavesMainUnchanged,
} from "./cli-harness.mjs";

test("integrate は記録が無いと exit 2 で本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    assertIntegrationRefusalLeavesMainUnchanged(t, /記録がありません/);
  } finally { t.cleanup(); }
});

test("integrate は worktree list に無い記録を exit 2 で拒否して本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    fs.rmSync(worktreePath, { recursive: true, force: true });
    git(t.wsRepo, "worktree", "prune");

    assertIntegrationRefusalLeavesMainUnchanged(t, /worktree list にありません/);
  } finally { t.cleanup(); }
});

test("integrate は worktree の生きたロックを exit 2 で拒否して本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record } = createCleanRecordedWorktree(t);
    writeLiveWorkerLock(t, record.path);

    assertIntegrationRefusalLeavesMainUnchanged(t, /別の worker が実行中/);
  } finally { t.cleanup(); }
});

test("integrate は本体の生きたロックを exit 2 で拒否して本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    createCleanRecordedWorktree(t);
    writeLiveWorkerLock(t, t.wsRepo);

    assertIntegrationRefusalLeavesMainUnchanged(t, /別の worker が実行中/);
  } finally { t.cleanup(); }
});

test("integrate は clean でない worktree を exit 2 で拒否して本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { worktreePath } = createCleanRecordedWorktree(t);
    fs.writeFileSync(path.join(worktreePath, "untracked.txt"), "uncommitted\n");

    assertIntegrationRefusalLeavesMainUnchanged(t, /監督が自分の変えたファイルをパス指定でコミットしてから/);
  } finally { t.cleanup(); }
});

test("integrate は本体ブランチが base_ref と違うと exit 2 で本体を変えない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { record } = createCleanRecordedWorktree(t);
    git(t.wsRepo, "checkout", "-q", "-b", "different-base");
    assert.notEqual(
      git(t.wsRepo, "symbolic-ref", "HEAD").trim(),
      record.base_ref,
    );

    assertIntegrationRefusalLeavesMainUnchanged(t, /本体のブランチが記録時の base_ref と一致しません/);
  } finally { t.cleanup(); }
});

test(
  "integrate は本体が先に進んだ時 exit 1 で rebase を案内して本体を変えない",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const { record, worktreePath } = createCleanRecordedWorktree(t);
      fs.writeFileSync(path.join(worktreePath, "src/a/impl.ts"), "worktree change\n");
      git(worktreePath, "add", "src/a/impl.ts");
      git(worktreePath, "commit", "-qm", "worktree change");

      fs.writeFileSync(path.join(t.wsRepo, "main-only.ts"), "main change\n");
      git(t.wsRepo, "add", "main-only.ts");
      git(t.wsRepo, "commit", "-qm", "main advanced");

      const baseBranch = record.base_ref.slice("refs/heads/".length);
      const expectedRebase = `git -C ${fs.realpathSync(worktreePath)} rebase ${baseBranch}`;
      assertIntegrationFailureLeavesMainUnchanged(t, expectedRebase);
    } finally { t.cleanup(); }
  },
);

test(
  "integrate は本体の未コミット重複変更で exit 1 となり本体を変えない",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const { worktreePath } = createCleanRecordedWorktree(t);
      fs.writeFileSync(path.join(worktreePath, "src/a/fixture.ts"), "worktree change\n");
      git(worktreePath, "add", "src/a/fixture.ts");
      git(worktreePath, "commit", "-qm", "worktree change");

      fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "uncommitted main change\n");

      assertIntegrationFailureLeavesMainUnchanged(t, "would be overwritten by merge");
    } finally { t.cleanup(); }
  },
);

test(
  "integrate は後始末の git worktree remove が失敗しても exit 0 で cleanup_errors と cleanup=failed を残す",
  () => {
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
      const branchTip = git(worktreePath, "rev-parse", "HEAD").trim();
      git(t.wsRepo, "worktree", "lock", worktreePath);

      const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

      assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
      assert.equal(integrated.json.head, branchTip);
      assert.equal(git(t.wsRepo, "rev-parse", "HEAD").trim(), branchTip);
      assert.ok(Array.isArray(integrated.json.cleanup_errors));
      assert.ok(integrated.json.cleanup_errors.some((error) => error.includes("worktree remove")));
      assert.ok(integrated.json.cleanup_errors.some((error) => error.includes("worktree --root")));
      assert.equal(fs.existsSync(worktreePath), true);
      assert.notEqual(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
      assert.equal(fs.existsSync(recordPath), true);

      const lines = worklogEntries(t, "integrate");
      assert.equal(lines.length, 1);
      assert.ok(lines[0].includes(`branch=${record.branch}`), lines[0]);
      assert.ok(lines[0].includes("commits=1"), lines[0]);
      assert.ok(lines[0].includes("cleanup=failed"), lines[0]);
    } finally { t.cleanup(); }
  },
);
