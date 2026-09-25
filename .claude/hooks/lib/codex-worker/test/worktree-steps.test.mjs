// @ts-check

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { canonical } from "../../../check-task-scope.mjs";
import { ensureWorktree, worktreeBranch, worktreeDir } from "../worktree.mjs";
import {
  ensureStepWorktree,
  integrateStepWorktree,
  pendingStepWorktrees,
  readStepWorktreeRecord,
} from "../worktree/steps.mjs";

const TASK = "T42";

/** Environment keys the fixture overrides, restored on cleanup. */
const FIXTURE_ENV_KEYS = [
  "XDG_STATE_HOME",
  "GIT_AUTHOR_NAME",
  "GIT_AUTHOR_EMAIL",
  "GIT_COMMITTER_NAME",
  "GIT_COMMITTER_EMAIL",
];

/**
 * Run git with a temporary identity so commits work independently of user configuration.
 * @param {string} root
 * @param {...string} args
 * @returns {string}
 */
function git(root, ...args) {
  return execFileSync(
    "git",
    ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args],
    { encoding: "utf8" },
  ).trim();
}

/**
 * Create a repository with a task worktree. The production rebase creates commits, so the
 * fixture also sets a git identity through the environment.
 * @returns {{ root: string, taskRecord: import("../worktree/record.mjs").WorktreeRecord,
 *   cleanup: () => void }}
 */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-steps-test-"));
  const root = path.join(base, "repo");
  const saved = Object.fromEntries(FIXTURE_ENV_KEYS.map((key) => [key, process.env[key]]));
  process.env.XDG_STATE_HOME = path.join(base, "state");
  process.env.GIT_AUTHOR_NAME = "t";
  process.env.GIT_AUTHOR_EMAIL = "t@example.com";
  process.env.GIT_COMMITTER_NAME = "t";
  process.env.GIT_COMMITTER_EMAIL = "t@example.com";
  fs.mkdirSync(root);
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, "add", "base.txt");
  git(root, "commit", "-qm", "initial");

  const ensured = ensureWorktree({ root, task: TASK, repo: root });
  if (!ensured.ok) throw new Error(ensured.errors.join("\n"));

  return {
    root,
    taskRecord: ensured.record,
    cleanup() {
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/**
 * Write a file in a worktree and commit it, as the supervisor does after accepting a step.
 * @param {string} worktree
 * @param {string} file
 * @param {string} content
 * @returns {void}
 */
function commitFile(worktree, file, content) {
  fs.writeFileSync(path.join(worktree, file), content);
  git(worktree, "add", file);
  git(worktree, "commit", "-qm", `add ${file}`);
}

/**
 * Create a step worktree and fail the test with the refusal text when it is refused.
 * @param {string} root
 * @param {import("../worktree/record.mjs").WorktreeRecord} taskRecord
 * @param {string} step
 * @returns {import("../worktree/record.mjs").WorktreeRecord}
 */
function createStep(root, taskRecord, step) {
  const result = ensureStepWorktree({ root, task: TASK, step, taskRecord });
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.record;
}

test("ステップの worktree は T のブランチの先端から <T>-s<番号> の置き場とブランチで作られ、2 回目は再利用する", () => {
  const { root, taskRecord, cleanup } = fixture();
  try {
    commitFile(taskRecord.path, "done-before.txt", "integrated earlier\n");
    const taskTip = git(taskRecord.path, "rev-parse", "HEAD");

    const first = ensureStepWorktree({ root, task: TASK, step: "2", taskRecord });
    const second = ensureStepWorktree({ root, task: TASK, step: "2", taskRecord });

    assert.equal(first.ok, true);
    if (!first.ok || !second.ok) return;
    assert.equal(first.created, true);
    assert.equal(first.record.branch, worktreeBranch(root, `${TASK}-s2`));
    assert.equal(first.record.path, canonical(worktreeDir(root, `${TASK}-s2`)));
    assert.equal(first.record.base, taskTip);
    assert.equal(first.record.base_ref, `refs/heads/${taskRecord.branch}`);
    assert.ok(fs.existsSync(path.join(first.record.path, "done-before.txt")), "統合済みの成果が見える");
    assert.deepEqual(readStepWorktreeRecord(root, TASK, "2"), first.record);
    assert.equal(second.created, false);
    assert.deepEqual(second.record, first.record);
  } finally { cleanup(); }
});

test("同時に作った 2 つのステップは、別々のファイルなら両方とも T の worktree へ直線の履歴で統合され、置き場と記録が消える", () => {
  const { root, taskRecord, cleanup } = fixture();
  try {
    const s1 = createStep(root, taskRecord, "1");
    const s2 = createStep(root, taskRecord, "2");
    commitFile(s1.path, "one.txt", "one\n");
    commitFile(s2.path, "two.txt", "two\n");

    const first = integrateStepWorktree({ root, task: TASK, step: "1", taskRecord });
    const second = integrateStepWorktree({ root, task: TASK, step: "2", taskRecord });

    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.ok, true, JSON.stringify(second));
    if (!second.ok) return;
    assert.equal(second.report.commits, 1);
    assert.equal(fs.readFileSync(path.join(taskRecord.path, "one.txt"), "utf8"), "one\n");
    assert.equal(fs.readFileSync(path.join(taskRecord.path, "two.txt"), "utf8"), "two\n");
    const merges = git(taskRecord.path, "rev-list", "--merges", "--count", "HEAD");
    assert.equal(merges, "0", "マージコミットを作らない");
    assert.equal(fs.existsSync(s1.path), false);
    assert.equal(fs.existsSync(s2.path), false);
    assert.equal(git(root, "branch", "--list", s2.branch), "");
    assert.deepEqual(pendingStepWorktrees(root, TASK), []);
  } finally { cleanup(); }
});

test("同じファイルを変えたステップの統合は衝突として exit 1 で止まり、rebase を取り消して置き場と記録を残す", () => {
  const { root, taskRecord, cleanup } = fixture();
  try {
    const s1 = createStep(root, taskRecord, "1");
    const s2 = createStep(root, taskRecord, "2");
    commitFile(s1.path, "base.txt", "from step 1\n");
    commitFile(s2.path, "base.txt", "from step 2\n");
    const integrated = integrateStepWorktree({ root, task: TASK, step: "1", taskRecord });
    assert.equal(integrated.ok, true, JSON.stringify(integrated));

    const conflicted = integrateStepWorktree({ root, task: TASK, step: "2", taskRecord });

    assert.equal(conflicted.ok, false);
    if (conflicted.ok) return;
    assert.equal(conflicted.code, 1);
    assert.match(conflicted.errors.join("\n"), /衝突/);
    assert.equal(fs.readFileSync(path.join(s2.path, "base.txt"), "utf8"), "from step 2\n");
    assert.equal(git(s2.path, "status", "--porcelain"), "", "rebase の途中の状態を残さない");
    assert.deepEqual(pendingStepWorktrees(root, TASK), ["2"]);
  } finally { cleanup(); }
});

test("未コミットの変更があるステップ・記録の無いステップの統合は exit 2 で拒否し、何も変えない", () => {
  const { root, taskRecord, cleanup } = fixture();
  try {
    const s1 = createStep(root, taskRecord, "1");
    fs.writeFileSync(path.join(s1.path, "loose.txt"), "not committed\n");
    const taskHead = git(taskRecord.path, "rev-parse", "HEAD");

    const dirty = integrateStepWorktree({ root, task: TASK, step: "1", taskRecord });
    const missing = integrateStepWorktree({ root, task: TASK, step: "9", taskRecord });

    assert.equal(dirty.ok, false);
    if (dirty.ok || missing.ok) return;
    assert.equal(dirty.code, 2);
    assert.match(dirty.errors.join("\n"), /未コミット/);
    assert.equal(missing.code, 2);
    assert.match(missing.errors.join("\n"), /記録が無い/);
    assert.equal(git(taskRecord.path, "rev-parse", "HEAD"), taskHead);
    assert.ok(fs.existsSync(path.join(s1.path, "loose.txt")));
  } finally { cleanup(); }
});
