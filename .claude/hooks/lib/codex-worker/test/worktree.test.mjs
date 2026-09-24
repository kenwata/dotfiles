// @ts-check

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { canonical } from "../../../check-task-scope.mjs";
import { rootSlug, stateDir } from "../worklog.mjs";
import {
  ensureWorktree,
  integrateWorktree,
  readWorktreeRecord,
  removeWorktree,
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  worktreeStatus,
} from "../worktree.mjs";

const TASK = "T42";

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
 * Create an isolated repository and state directory, restoring the caller's environment on cleanup.
 * @returns {{ base: string, root: string, cleanup: () => void }}
 */
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "worktree-test-"));
  const root = path.join(base, "repo");
  const state = path.join(base, "state");
  const savedStateHome = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = state;
  fs.mkdirSync(root);
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "base.txt"), "base\n");
  git(root, "add", "base.txt");
  git(root, "commit", "-qm", "initial");

  return {
    base,
    root,
    cleanup() {
      if (savedStateHome === undefined) delete process.env.XDG_STATE_HOME;
      else process.env.XDG_STATE_HOME = savedStateHome;
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

/** Write a complete worktree record as the production reader expects it.
 * @param {string} root
 * @param {string} task
 * @param {{ repo: string, path: string, branch: string, base: string, base_ref: string,
 *   created_at: string }} record
 * @returns {void}
 */
function saveRecord(root, task, record) {
  fs.writeFileSync(worktreeRecordPath(root, task), `${JSON.stringify(record, null, 2)}\n`);
}

/**
 * Assert that a refusal names its reason and the concrete recovery command.
 * @param {{ ok: boolean, code?: number, errors?: string[] }} result
 * @param {string} reason
 * @param {string} root
 * @param {string} [task]
 * @returns {void}
 */
function assertRefusal(result, reason, root, task = TASK) {
  assert.deepEqual(result.ok, false);
  assert.equal(result.code, 2);
  assert.match(result.errors.join("\n"), new RegExp(reason));
  const recovery = [
    "node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree",
    `--root ${root}`,
    `--task ${task}`,
    "--remove --force",
  ].join(" ");
  assert.ok(result.errors.join("\n").includes(recovery));
}

test(
  "初回作成は規定の置き場・ブランチ名・6 キーの記録を使う",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const now = new Date("2026-09-24T12:34:56.000Z");
      const result = ensureWorktree({ root, task: TASK, repo: root, now });
      const record = result.record;
      const rootHash = createHash("sha1").update(canonical(root)).digest("hex").slice(0, 8);
      const expectedBranch = `codex-worker/${rootHash}/${TASK}`;

      assert.equal(result.ok, true);
      assert.equal(result.created, true);
      assert.equal(worktreeBranch(root, TASK), expectedBranch);
      assert.equal(
        worktreeDir(root, TASK),
        path.join(stateDir(), "worktrees", rootSlug(root), TASK),
      );
      assert.equal(record.path, canonical(worktreeDir(root, TASK)));
      assert.equal(record.repo, canonical(root));
      assert.equal(record.branch, expectedBranch);
      assert.equal(record.base, git(root, "rev-parse", "HEAD"));
      assert.equal(record.base_ref, git(root, "symbolic-ref", "HEAD"));
      assert.equal(record.created_at, now.toISOString());
      assert.deepEqual(
        Object.keys(record).sort(),
        ["base", "base_ref", "branch", "created_at", "path", "repo"],
      );
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.ok(git(root, "worktree", "list", "--porcelain").includes(`worktree ${record.path}`));
    } finally {
      cleanup();
    }
  },
);

test(
  "既存の記録が登録済み worktree を指す時は再利用する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const created = ensureWorktree({ root, task: TASK, repo: root });
      const reused = ensureWorktree({ root, task: TASK, repo: root });

      assert.equal(created.created, true);
      assert.deepEqual(reused, { ok: true, created: false, record: created.record });
      assert.equal(readWorktreeRecord(root, TASK).created_at, created.record.created_at);
    } finally {
      cleanup();
    }
  },
);

test(
  "記録が無く置き場に未登録のディレクトリがある時は拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      fs.mkdirSync(worktreeDir(root, TASK), { recursive: true });
      fs.writeFileSync(path.join(worktreeDir(root, TASK), "keep.txt"), "keep\n");

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "置き場.*登録外", root);
      assert.equal(fs.existsSync(worktreeRecordPath(root, TASK)), false);
      assert.equal(fs.existsSync(path.dirname(worktreeDir(root, TASK))), true);
      assert.equal(
        git(
          root,
          "for-each-ref",
          "--format=%(refname)",
          `refs/heads/${worktreeBranch(root, TASK)}`,
        ),
        "",
      );
      const keptFile = fs.readFileSync(path.join(worktreeDir(root, TASK), "keep.txt"), "utf8");
      assert.equal(keptFile, "keep\n");
    } finally {
      cleanup();
    }
  },
);

test(
  "記録が無くブランチだけが残っている時は拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      git(root, "branch", worktreeBranch(root, TASK));

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "ブランチ.*残って", root);
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.equal(fs.existsSync(path.dirname(worktreeDir(root, TASK))), false);
      assert.equal(fs.existsSync(worktreeRecordPath(root, TASK)), false);
      assert.equal(
        git(
          root,
          "for-each-ref",
          "--format=%(refname)",
          `refs/heads/${worktreeBranch(root, TASK)}`,
        ),
        `refs/heads/${worktreeBranch(root, TASK)}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "記録が無くブランチが別の worktree で checkout 済みなら拒否する",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const mainBranch = git(root, "symbolic-ref", "--short", "HEAD");
      const branch = worktreeBranch(root, TASK);
      const elsewhere = path.join(base, "elsewhere");
      git(root, "worktree", "add", "-b", branch, elsewhere, "HEAD");

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "別の場所.*checkout", root);
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.equal(fs.existsSync(path.dirname(worktreeDir(root, TASK))), false);
      assert.equal(fs.existsSync(worktreeRecordPath(root, TASK)), false);
      assert.equal(git(root, "symbolic-ref", "--short", "HEAD"), mainBranch);
      assert.equal(git(elsewhere, "symbolic-ref", "--short", "HEAD"), branch);
    } finally {
      cleanup();
    }
  },
);

test(
  "記録があるのに worktree が無い時は自動修復せず拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const created = ensureWorktree({ root, task: TASK, repo: root });
      git(root, "worktree", "remove", "--force", created.record.path);

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "記録.*worktree が存在しません", root);
      assert.equal(readWorktreeRecord(root, TASK).path, created.record.path);
      assert.equal(fs.existsSync(created.record.path), false);
      assert.equal(fs.existsSync(path.dirname(worktreeDir(root, TASK))), true);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${created.record.branch}`),
        `refs/heads/${created.record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "記録の repo が引数の本体と違う時は再利用せず拒否する",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const other = path.join(base, "other-repo");
      fs.mkdirSync(other);
      git(other, "init", "-q");
      fs.writeFileSync(path.join(other, "base.txt"), "other\n");
      git(other, "add", "base.txt");
      git(other, "commit", "-qm", "other initial");
      const changed = { ...record, repo: canonical(other) };
      saveRecord(root, TASK, changed);

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "本体リポジトリが一致しません", root);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "置き場の登録ブランチが記録と違う時は再利用せず拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const otherBranch = `${record.branch}-other`;
      git(root, "branch", otherBranch);
      git(record.path, "checkout", otherBranch);
      const beforeRecordBranch = git(root, "rev-parse", record.branch);
      const beforeOtherBranch = git(root, "rev-parse", otherBranch);
      const beforeHead = git(root, "rev-parse", "HEAD");
      const beforeStatus = git(root, "status", "--porcelain");
      const beforeList = git(root, "worktree", "list", "--porcelain");

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assertRefusal(result, "HEAD.*記録のブランチ", root);
      assert.equal(git(root, "rev-parse", "HEAD"), beforeHead);
      assert.equal(git(root, "status", "--porcelain"), beforeStatus);
      assert.equal(git(root, "worktree", "list", "--porcelain"), beforeList);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeRecordBranch);
      assert.equal(git(root, "rev-parse", otherBranch), beforeOtherBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${otherBranch}`),
        `refs/heads/${otherBranch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "本体が detached HEAD なら新しい worktree を作成せず拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      git(root, "checkout", "--detach", "-q");

      const result = ensureWorktree({ root, task: TASK, repo: root });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.match(result.errors.join("\n"), /本体でブランチを checkout してから/);
      assert.doesNotMatch(result.errors.join("\n"), /--remove --force/);
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.equal(fs.existsSync(path.dirname(worktreeDir(root, TASK))), false);
      assert.equal(fs.existsSync(worktreeRecordPath(root, TASK)), false);
      assert.equal(
        git(
          root,
          "for-each-ref",
          "--format=%(refname)",
          `refs/heads/${worktreeBranch(root, TASK)}`,
        ),
        "",
      );
      assert.equal(git(root, "worktree", "list", "--porcelain").match(/^worktree /gm).length, 1);
    } finally {
      cleanup();
    }
  },
);

test(
  "状態は 7 欄を返し、ahead と behind を数値で数える",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      assert.equal(worktreeStatus(root, TASK), null);
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "untracked.txt"), "dirty\n");
      fs.writeFileSync(path.join(record.path, "branch.txt"), "branch\n");
      git(record.path, "add", "branch.txt");
      git(record.path, "commit", "-qm", "branch commit");
      fs.writeFileSync(path.join(root, "main.txt"), "main\n");
      git(root, "add", "main.txt");
      git(root, "commit", "-qm", "main commit");

      const status = worktreeStatus(root, TASK);

      assert.deepEqual(
        Object.keys(status),
        ["path", "branch", "base_ref", "exists", "dirty", "ahead", "behind"],
      );
      assert.equal(status.path, record.path);
      assert.equal(status.branch, record.branch);
      assert.equal(status.base_ref, record.base_ref);
      assert.equal(status.exists, true);
      assert.equal(status.dirty, true);
      assert.equal(status.ahead, 1);
      assert.equal(status.behind, 1);
    } finally {
      cleanup();
    }
  },
);

test(
  "worktree とブランチが無い状態では ahead と behind を null で返す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      git(root, "worktree", "remove", "--force", record.path);
      git(root, "branch", "-D", record.branch);

      const status = worktreeStatus(root, TASK);

      assert.equal(status.exists, false);
      assert.equal(status.dirty, false);
      assert.equal(status.ahead, null);
      assert.equal(status.behind, null);
    } finally {
      cleanup();
    }
  },
);

test(
  "汚れた worktree は force 無しで破棄を拒否し、force で破棄する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "untracked.txt"), "keep until forced\n");
      const beforeStatus = git(record.path, "status", "--porcelain");
      const beforeBranch = git(root, "rev-parse", record.branch);

      const refused = removeWorktree({ root, task: TASK, repo: root });

      assert.equal(refused.ok, false);
      assert.equal(refused.code, 2);
      assert.equal(fs.existsSync(record.path), true);
      assert.equal(git(record.path, "status", "--porcelain"), beforeStatus);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );

      const removed = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(removed, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "未統合コミットのある worktree は force 無しで拒否し、force でブランチごと消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "branch.txt"), "branch\n");
      git(record.path, "add", "branch.txt");
      git(record.path, "commit", "-qm", "branch commit");
      const beforeStatus = git(record.path, "status", "--porcelain");
      const beforeBranch = git(root, "rev-parse", record.branch);

      const refused = removeWorktree({ root, task: TASK, repo: root });

      assert.equal(refused.ok, false);
      assert.equal(refused.code, 2);
      assert.equal(fs.existsSync(record.path), true);
      assert.equal(git(record.path, "status", "--porcelain"), beforeStatus);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );

      const removed = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(removed, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は置き場に残った登録外のディレクトリを片付ける",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      fs.mkdirSync(worktreeDir(root, TASK), { recursive: true });
      fs.writeFileSync(path.join(worktreeDir(root, TASK), "keep.txt"), "orphan\n");

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
    } finally {
      cleanup();
    }
  },
);

test(
  "force は記録の無いタスクブランチだけの残骸を消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const branch = worktreeBranch(root, TASK);
      git(root, "branch", branch);

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`), "");
      assert.equal(readWorktreeRecord(root, TASK), null);
    } finally {
      cleanup();
    }
  },
);

test(
  "force は記録があるが worktree が無い残骸を片付ける",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      git(root, "worktree", "remove", "--force", record.path);

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は別の場所で checkout 中のタスクブランチを消さない",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const branch = worktreeBranch(root, TASK);
      const elsewhere = path.join(base, "elsewhere");
      git(root, "worktree", "add", "-b", branch, elsewhere, "HEAD");

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.equal(fs.existsSync(elsewhere), true);
      assert.equal(git(elsewhere, "symbolic-ref", "--short", "HEAD"), branch);
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.equal(fs.existsSync(worktreeRecordPath(root, TASK)), false);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${branch}`),
        `refs/heads/${branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force 破棄は記録の置き場違いを拒否し、外のディレクトリを残す",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      git(root, "worktree", "remove", "--force", record.path);
      const outside = path.join(base, "outside");
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "keep.txt"), "keep\n");
      const changed = { ...record, path: outside };
      saveRecord(root, TASK, changed);
      const beforeBranch = git(root, "rev-parse", record.branch);

      const refused = removeWorktree({ root, task: TASK, repo: root });

      assert.equal(refused.ok, false);
      assert.equal(refused.code, 2);
      assert.match(refused.errors.join("\n"), /置き場/);
      assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep\n");
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );

      const forced = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.equal(forced.ok, false);
      assert.equal(forced.code, 2);
      assert.match(forced.errors.join("\n"), /置き場/);
      assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep\n");
      assert.equal(fs.existsSync(worktreeDir(root, TASK)), false);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は消えた対象登録だけを外し、別の消えた worktree 登録を残す",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const other = path.join(base, "other-worktree");
      git(root, "worktree", "add", "-b", "other-branch", other, "HEAD");
      fs.rmSync(record.path, { recursive: true, force: true });
      fs.rmSync(other, { recursive: true, force: true });
      const beforeList = git(root, "worktree", "list", "--porcelain");
      assert.ok(beforeList.includes(canonical(record.path)));
      assert.ok(beforeList.includes(canonical(other)));

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      const afterList = git(root, "worktree", "list", "--porcelain");
      assert.equal(afterList.includes(canonical(record.path)), false);
      assert.ok(afterList.includes(canonical(other)));
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は detached HEAD の task worktree をブランチごと消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      git(record.path, "checkout", "--detach", "-q");

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は置き場で別ブランチを checkout 中でも task worktree を消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const otherBranch = `${record.branch}-other`;
      git(root, "branch", otherBranch);
      git(record.path, "checkout", otherBranch);

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${otherBranch}`),
        `refs/heads/${otherBranch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は rebase conflict で停止した task worktree をブランチごと消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "base.txt"), "task version\n");
      git(record.path, "add", "base.txt");
      git(record.path, "commit", "-qm", "task change");
      fs.writeFileSync(path.join(root, "base.txt"), "main version\n");
      git(root, "add", "base.txt");
      git(root, "commit", "-qm", "main change");
      assert.throws(() => git(record.path, "rebase", record.base_ref.slice("refs/heads/".length)));
      assert.match(git(record.path, "status", "--porcelain"), /UU base\.txt/);

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.deepEqual(result, { ok: true });
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "force は置き場がシンボリックリンクなら拒否してリンク先を残す",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const target = worktreeDir(root, TASK);
      const outside = path.join(base, "outside");
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.mkdirSync(outside);
      fs.writeFileSync(path.join(outside, "keep.txt"), "keep\n");
      fs.symlinkSync(outside, target, "dir");

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.match(result.errors.join("\n"), /シンボリックリンク/);
      assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
      assert.equal(fs.readFileSync(path.join(outside, "keep.txt"), "utf8"), "keep\n");
      assert.equal(readWorktreeRecord(root, TASK), null);
    } finally {
      cleanup();
    }
  },
);

test(
  "記録の repo が破棄時の本体と違う時は force でも拒否する",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const changed = { ...record, repo: path.join(base, "missing-repo") };
      saveRecord(root, TASK, changed);
      const beforeBranch = git(root, "rev-parse", record.branch);

      const result = removeWorktree({ root, task: TASK, repo: root, force: true });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.match(result.errors.join("\n"), /本体リポジトリ/);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "壊れた記録を読む破棄と統合は例外で落ちず code 2 で拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const beforeBranch = git(root, "rev-parse", record.branch);
      const malformed = "{\n";
      fs.writeFileSync(worktreeRecordPath(root, TASK), malformed);

      const removal = removeWorktree({ root, task: TASK, repo: root });
      const integration = integrateWorktree({ root, task: TASK });

      assert.equal(removal.ok, false);
      assert.equal(removal.code, 2);
      assert.match(removal.errors.join("\n"), /記録/);
      assert.equal(integration.ok, false);
      assert.equal(integration.code, 2);
      assert.match(integration.errors.join("\n"), /記録/);
      assert.equal(fs.readFileSync(worktreeRecordPath(root, TASK), "utf8"), malformed);
      assert.equal(fs.existsSync(record.path), true);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "記録の repo が無い破棄と統合は例外で落ちず code 2 で拒否する",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const beforeBranch = git(root, "rev-parse", record.branch);
      const missingRepo = path.join(base, "removed-repo");
      const changed = { ...record, repo: missingRepo };
      saveRecord(root, TASK, changed);

      const removal = removeWorktree({ root, task: TASK, repo: root, force: true });
      const integration = integrateWorktree({ root, task: TASK });

      assert.equal(removal.ok, false);
      assert.equal(removal.code, 2);
      assert.equal(integration.ok, false);
      assert.equal(integration.code, 2);
      assert.ok(removal.errors.length > 0);
      assert.ok(integration.errors.length > 0);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(fs.existsSync(record.path), true);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "置き場が違う worktree 記録の統合は拒否して状態を保つ",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      const changed = { ...record, path: path.join(base, "outside") };
      saveRecord(root, TASK, changed);
      const beforeBranch = git(root, "rev-parse", record.branch);
      const beforeHead = git(root, "rev-parse", "HEAD");
      const beforeStatus = git(root, "status", "--porcelain");

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.match(result.errors.join("\n"), /置き場/);
      assert.equal(git(root, "rev-parse", "HEAD"), beforeHead);
      assert.equal(git(root, "status", "--porcelain"), beforeStatus);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), changed);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "list の task worktree が別 branch の HEAD なら理由を示して統合を拒否する",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      git(record.path, "checkout", "--detach", "-q");
      const beforeBranch = git(root, "rev-parse", record.branch);
      const beforeHead = git(root, "rev-parse", "HEAD");
      const beforeStatus = git(root, "status", "--porcelain");
      const beforeList = git(root, "worktree", "list", "--porcelain");

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, false);
      assert.equal(result.code, 2);
      assert.match(result.errors.join("\n"), /HEAD.*記録のブランチ/);
      assert.doesNotMatch(result.errors.join("\n"), /list にありません/);
      assert.equal(git(root, "rev-parse", "HEAD"), beforeHead);
      assert.equal(git(root, "status", "--porcelain"), beforeStatus);
      assert.equal(git(root, "worktree", "list", "--porcelain"), beforeList);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "統合は fast-forward し、無関係な本体の変更を残して片付ける",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      fs.writeFileSync(path.join(root, "unrelated-tracked.txt"), "tracked base\n");
      git(root, "add", "unrelated-tracked.txt");
      git(root, "commit", "-qm", "add unrelated tracked file");
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "branch.txt"), "branch\n");
      git(record.path, "add", "branch.txt");
      git(record.path, "commit", "-qm", "branch commit");
      fs.writeFileSync(path.join(root, "unrelated-tracked.txt"), "keep changed\n");
      fs.writeFileSync(path.join(root, "unrelated.txt"), "keep\n");

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, true);
      assert.deepEqual(Object.keys(result.report), ["task", "repo", "branch", "commits", "head"]);
      assert.equal(result.report.task, TASK);
      assert.equal(result.report.repo, canonical(root));
      assert.equal(result.report.branch, record.branch);
      assert.equal(result.report.commits, 1);
      assert.equal(result.report.head, git(root, "rev-parse", "HEAD"));
      assert.equal(
        fs.readFileSync(path.join(root, "unrelated-tracked.txt"), "utf8"),
        "keep changed\n",
      );
      assert.equal(fs.readFileSync(path.join(root, "unrelated.txt"), "utf8"), "keep\n");
      assert.equal(git(root, "status", "--porcelain"), "M unrelated-tracked.txt\n?? unrelated.txt");
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "本体が先に進んでいる時は統合を拒否し本体の HEAD と status を保つ",
  /** @returns {void} */
  () => {
    const { base, root, cleanup } = fixture();
    try {
      process.env.XDG_STATE_HOME = path.join(base, "state with spaces");
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "branch.txt"), "branch\n");
      git(record.path, "add", "branch.txt");
      git(record.path, "commit", "-qm", "branch commit");
      fs.writeFileSync(path.join(root, "main.txt"), "main\n");
      git(root, "add", "main.txt");
      git(root, "commit", "-qm", "main commit");
      const beforeBranch = git(root, "rev-parse", record.branch);
      const beforeHead = git(root, "rev-parse", "HEAD");
      const beforeStatus = git(root, "status", "--porcelain");
      const baseBranch = git(root, "symbolic-ref", "--short", "HEAD");

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, false);
      assert.equal(result.code, 1);
      assert.ok(
        result.errors.join("\n").includes(`git -C '${record.path}' rebase ${baseBranch}`),
      );
      assert.equal(git(root, "rev-parse", "HEAD"), beforeHead);
      assert.equal(git(root, "status", "--porcelain"), beforeStatus);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "未コミット変更と重なる fast-forward を拒否し本体の HEAD と status を保つ",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });
      fs.writeFileSync(path.join(record.path, "base.txt"), "branch version\n");
      git(record.path, "add", "base.txt");
      git(record.path, "commit", "-qm", "branch commit");
      fs.writeFileSync(path.join(root, "base.txt"), "local version\n");
      const beforeBranch = git(root, "rev-parse", record.branch);
      const beforeHead = git(root, "rev-parse", "HEAD");
      const beforeStatus = git(root, "status", "--porcelain");

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, false);
      assert.equal(result.code, 1);
      assert.ok(result.errors.join("\n").length > 0);
      assert.match(result.errors.join("\n"), /error:|fatal:/i);
      assert.ok(result.errors.join("\n").includes("base.txt"));
      assert.equal(git(root, "rev-parse", "HEAD"), beforeHead);
      assert.equal(git(root, "status", "--porcelain"), beforeStatus);
      assert.equal(fs.existsSync(record.path), true);
      assert.deepEqual(readWorktreeRecord(root, TASK), record);
      assert.equal(git(root, "rev-parse", record.branch), beforeBranch);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        `refs/heads/${record.branch}`,
      );
    } finally {
      cleanup();
    }
  },
);

test(
  "先行コミットが 0 件でも統合成功として worktree とブランチを消す",
  /** @returns {void} */
  () => {
    const { root, cleanup } = fixture();
    try {
      const { record } = ensureWorktree({ root, task: TASK, repo: root });

      const result = integrateWorktree({ root, task: TASK });

      assert.equal(result.ok, true);
      assert.equal(result.report.commits, 0);
      assert.equal(result.report.head, git(root, "rev-parse", "HEAD"));
      assert.equal(fs.existsSync(record.path), false);
      assert.equal(readWorktreeRecord(root, TASK), null);
      assert.equal(
        git(root, "for-each-ref", "--format=%(refname)", `refs/heads/${record.branch}`),
        "",
      );
    } finally {
      cleanup();
    }
  },
);
