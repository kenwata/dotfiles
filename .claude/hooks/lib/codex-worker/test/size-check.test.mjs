// @ts-check

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { sizeCheckRun } from "../commands/size-check.mjs";
import { takeSnapshot } from "../core.mjs";

const cli = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "cli.mjs");

/** @typedef {{ files: Record<string, { saved?: string | null }> }} TestSnapshot */
/** @typedef {{ base: string, repo: string, root: string, runDir: string,
 * snapshot: TestSnapshot, cleanup: () => void }} Fixture */

/** @typedef {{ snapshotContent?: string }} FixtureOptions */

/** Run git in the fixture repository with a deterministic commit identity.
 * @param {string} root Repository or nested worktree path.
 * @param {...string} args Git arguments.
 * @returns {string} Git stdout.
 */
function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com",
    "-c", "user.name=t", ...args], { encoding: "utf8" });
}

/** Write text after creating its parent directory.
 * @param {string} root Base directory.
 * @param {string} file Relative file path.
 * @param {string} content File contents.
 * @returns {void} Writes the requested file.
 */
function write(root, file, content) {
  const absolute = path.join(root, file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

/** Create a committed repository with a nested snapshot root.
 * @param {FixtureOptions} [options] Optional pre-snapshot file contents.
 * @returns {Fixture} Paths and cleanup for an isolated run fixture.
 */
function fixture({ snapshotContent } = {}) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-size-check-"));
  const repo = path.join(base, "repo");
  const root = path.join(repo, "nested");
  fs.mkdirSync(root, { recursive: true });
  git(repo, "init", "-q");
  write(root, "src/head.ts", "head one\nhead two\n");
  git(repo, "add", "-A");
  git(repo, "commit", "-qm", "initial");

  if (snapshotContent !== undefined) write(root, "src/head.ts", snapshotContent);

  const runDir = path.join(base, "run");
  const snapshot = takeSnapshot(root, runDir);
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({
    root,
    workspace: repo,
    task: "T1",
    step: "1",
    model: "test",
    allow: ["src/"],
  }));

  return {
    base,
    repo,
    root,
    runDir,
    snapshot,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

test("新規ファイルが上限を超えると違反になる", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "src/new.ts", "1\n2\n3\n");

    assert.deepEqual(sizeCheckRun(runDir, { maxFileLines: 2 }), {
      ok: false,
      max_file_lines: 2,
      violations: [{ path: "src/new.ts", lines: 3, snapshot_lines: null }],
      warnings: [],
    });
  } finally {
    cleanup();
  }
});

test("snapshot の上限以下の退避コピーを越えると違反になる", () => {
  const { root, runDir, snapshot, cleanup } = fixture({ snapshotContent: "a\nb\n" });
  try {
    assert.ok(snapshot.files["src/head.ts"].saved);
    write(root, "src/head.ts", "1\n2\n3\n");

    assert.deepEqual(sizeCheckRun(runDir, { maxFileLines: 2 }).violations, [
      { path: "src/head.ts", lines: 3, snapshot_lines: 2 },
    ]);
  } finally {
    cleanup();
  }
});

test("上限超過済みのファイルが伸びると警告になる", () => {
  const { root, runDir, snapshot, cleanup } = fixture({ snapshotContent: "1\n2\n3\n" });
  try {
    assert.ok(snapshot.files["src/head.ts"].saved);
    write(root, "src/head.ts", "1\n2\n3\n4\n");

    const result = sizeCheckRun(runDir, { maxFileLines: 2 });

    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.warnings, [
      { path: "src/head.ts", lines: 4, snapshot_lines: 3 },
    ]);
  } finally {
    cleanup();
  }
});

test("上限超過済みのファイルが縮むと何も出さない", () => {
  const { root, runDir, snapshot, cleanup } = fixture({
    snapshotContent: "1\n2\n3\n4\n",
  });
  try {
    assert.ok(snapshot.files["src/head.ts"].saved);
    write(root, "src/head.ts", "1\n2\n3\n");

    const result = sizeCheckRun(runDir, { maxFileLines: 2 });

    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanup();
  }
});

test("NUL を含むファイルは対象外", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "src/head.ts", "1\n2\n3\0\n4\n");

    const result = sizeCheckRun(runDir, { maxFileLines: 1 });

    assert.deepEqual(result.violations, []);
    assert.deepEqual(result.warnings, []);
  } finally {
    cleanup();
  }
});

test("表に無い拡張子は対象外", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "src/data.json", "1\n2\n3\n");

    assert.deepEqual(sizeCheckRun(runDir, { maxFileLines: 1 }).violations, []);
  } finally {
    cleanup();
  }
});

test("snapshot の退避コピーを基準行数に使う", () => {
  const { root, runDir, snapshot, cleanup } = fixture({ snapshotContent: "u\nv\n" });
  try {
    const savedPath = snapshot.files["src/head.ts"].saved;
    assert.ok(savedPath);
    write(root, "src/head.ts", "1\n2\n3\n");

    assert.deepEqual(sizeCheckRun(runDir, { maxFileLines: 2 }).violations, [
      { path: "src/head.ts", lines: 3, snapshot_lines: 2 },
    ]);
  } finally {
    cleanup();
  }
});

test("HEAD の内容と root 相対の allow を使って判定する", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "src/head.ts", "1\n2\n3\n");
    write(root, "src-other/outside.ts", "1\n2\n3\n");

    assert.deepEqual(sizeCheckRun(runDir, { maxFileLines: 2 }).violations, [
      { path: "src/head.ts", lines: 3, snapshot_lines: 2 },
    ]);
  } finally {
    cleanup();
  }
});

test("最後の行に改行が無ければ 1 行として数える", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "src/head.ts", "one\ntwo\nthree");

    assert.equal(sizeCheckRun(runDir, { maxFileLines: 2 }).violations[0].lines, 3);
  } finally {
    cleanup();
  }
});

test("run の記録が無い CLI は exit 2 と JSON を返す", () => {
  const result = spawnSync("node", [
    cli,
    "size-check",
    "--run",
    "/no/such/codex-worker-run",
  ], {
    encoding: "utf8",
  });

  assert.equal(result.status, 2);
  assert.deepEqual(JSON.parse(result.stdout), {
    errors: [
      "run の記録を読めない: /no/such/codex-worker-run: "
        + "ENOENT: no such file or directory, open "
        + "'/no/such/codex-worker-run/snapshot.json'",
    ],
  });
});
