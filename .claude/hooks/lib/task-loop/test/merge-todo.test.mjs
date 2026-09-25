// TODO.md 用 git merge driver の三方併合を検証する。
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const DRIVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../merge-todo.mjs");

function runDriver(baseText, oursText, theirsText, expectGitFallback = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "merge-todo-"));
  const files = ["base", "ours", "theirs"].map((name) => path.join(root, name));
  const inputs = [baseText, oursText, theirsText];
  inputs.forEach((text, index) => fs.writeFileSync(files[index], text));
  const fallback = expectGitFallback
    ? spawnSync("git", ["merge-file", "-p", files[1], files[0], files[2]], { encoding: "utf8" })
    : null;
  if (fallback) fs.writeFileSync(files[1], oursText);

  const result = spawnSync(process.execPath, [DRIVER, ...files], { encoding: "utf8" });
  const merged = fs.readFileSync(files[1], "utf8");
  fs.rmSync(root, { recursive: true, force: true });
  return { code: result.status, merged, stderr: result.stderr, fallback };
}

function git(root, ...args) {
  const result = spawnSync(
    "git",
    ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_CONFIG_GLOBAL: os.devNull, GIT_CONFIG_SYSTEM: os.devNull },
    },
  );
  assert.equal(result.status, 0, result.stderr);

  return result.stdout;
}

test("隣接する T 行を別々に完了にする", () => {
  const base = "| #1-1 | T1 | a | — | [ ] |\n| #1-2 | T2 | b | — | [ ] |\n";
  const ours = base.replace("T1 | a | — | [ ]", "T1 | a | — | [x]");
  const theirs = base.replace("T2 | b | — | [ ]", "T2 | b | — | [x]");

  const result = runDriver(base, ours, theirs);

  assert.equal(result.merged, "| #1-1 | T1 | a | — | [x] |\n| #1-2 | T2 | b | — | [x] |\n");
  assert.equal(result.code, 0);
  assert.match(result.stderr, /^\[merge-todo\] 鍵の併合/m);
});

test("同じ T 行を別々に変えると ours を残して衝突する", () => {
  const base = "| #1-1 | T1 | a | — | [ ] |\n";
  const ours = "| #1-1 | T1 | ours | — | [ ] |\n";
  const theirs = "| #1-1 | T1 | theirs | — | [ ] |\n";

  const result = runDriver(base, ours, theirs);

  assert.equal(result.merged, ours);
  assert.equal(result.code, 1);
  assert.match(result.stderr, /^\[merge-todo\] 鍵の併合: 衝突 T1$/m);
});

test(
  "ours だけが骨格に行を追加した時は ours の骨格へ三方の T 行を入れる",
  () => {
    const base = "見出し\n| #1-1 | T1 | a | — | [ ] |\n";
    const ours = "見出し\n追加行\n| #1-1 | T1 | a | — | [ ] |\n";
    const theirs = "見出し\n| #1-1 | T1 | a | — | [x] |\n";

    const result = runDriver(base, ours, theirs);

    assert.equal(result.merged, "見出し\n追加行\n| #1-1 | T1 | a | — | [x] |\n");
    assert.equal(result.code, 0);
  },
);

test("両側が骨格を変えた時は git merge-file の結果を返す", () => {
  const base = "head\n| #1-1 | T1 | a | — | [ ] |\ntail\n";
  const ours = "ours head\n| #1-1 | T1 | a | — | [ ] |\ntail\n";
  const theirs = "theirs head\n| #1-1 | T1 | a | — | [ ] |\ntail\n";
  const result = runDriver(base, ours, theirs, true);

  assert.equal(result.merged, result.fallback.stdout);
  assert.equal(result.code, result.fallback.status);
  assert.equal(
    result.stderr.trim(),
    "[merge-todo] git merge-file に落ちた: 骨格が両側で変わった",
  );
});

test("両側の同じ変更を採る", () => {
  const base = "| #1-1 | T1 | a | — | [ ] |\n";
  const changed = "| #1-1 | T1 | a | — | [x] |\n";

  const result = runDriver(base, changed, changed);

  assert.equal(result.merged, changed);
  assert.equal(result.code, 0);
});

test("重複する T 行がある版は git merge-file に落ちる", () => {
  const base = "| #1-1 | T1 | a | — | [ ] |\n";
  const ours = `${base}| #1-2 | T1 | b | — | [ ] |\n`;
  const theirs = base;
  const result = runDriver(base, ours, theirs, true);

  assert.equal(result.merged, result.fallback.stdout);
  assert.equal(result.code, result.fallback.status);
  assert.equal(
    result.stderr.trim(),
    "[merge-todo] git merge-file に落ちた: 同じ T の行が 2 回ある",
  );
});

test("linked worktree の rebase で driver を使い、両方の完了を直線履歴に残す", () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "merge-todo-worktree-")));
  const worktreeA = path.join(root, "a");
  const worktreeB = path.join(root, "b");

  try {
    git(root, "init", "-q", "-b", "main");
    fs.writeFileSync(
      path.join(root, "TODO.md"),
      "| # | T | タスク | 実 | 状態 |\n|---|---|---|---|---|\n"
        + "| #1-1 | T1 | 一 | — | [ ] |\n| #1-2 | T2 | 二 | — | [ ] |\n",
    );
    git(root, "add", "TODO.md");
    git(root, "commit", "-q", "-m", "initial TODO");

    fs.writeFileSync(path.join(root, ".git/info/attributes"), "TODO.md merge=task-loop-todo\n");
    git(root, "config", "merge.task-loop-todo.driver", `node ${DRIVER} %O %A %B`);
    git(root, "worktree", "add", "-q", "-b", "lane-a", worktreeA);
    git(root, "worktree", "add", "-q", "-b", "lane-b", worktreeB);

    const todoA = fs.readFileSync(path.join(worktreeA, "TODO.md"), "utf8")
      .replace("| #1-1 | T1 | 一 | — | [ ] |", "| #1-1 | T1 | 一 | — | [x] |");
    fs.writeFileSync(path.join(worktreeA, "TODO.md"), todoA);
    git(worktreeA, "commit", "-qam", "complete T1");

    const todoB = fs.readFileSync(path.join(worktreeB, "TODO.md"), "utf8")
      .replace("| #1-2 | T2 | 二 | — | [ ] |", "| #1-2 | T2 | 二 | — | [x] |");
    fs.writeFileSync(path.join(worktreeB, "TODO.md"), todoB);
    git(worktreeB, "commit", "-qam", "complete T2");

    git(worktreeA, "rebase", "main");
    git(root, "merge", "--ff-only", "lane-a");
    git(worktreeB, "rebase", "main");
    git(root, "merge", "--ff-only", "lane-b");

    const todo = fs.readFileSync(path.join(root, "TODO.md"), "utf8");
    assert.match(todo, /^\| #1-1 \| T1 \| 一 \| — \| \[x\] \|$/m);
    assert.match(todo, /^\| #1-2 \| T2 \| 二 \| — \| \[x\] \|$/m);
    assert.equal(git(root, "log", "--first-parent", "--merges"), "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
