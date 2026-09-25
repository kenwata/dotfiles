// codex-worker の cli の試験: run --worktree(T の worktree で worker を動かす)と integrate の正常系。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  git,
  setup,
  baseArgs,
  wsArgs,
  worklogEntries,
} from "./cli-harness.mjs";

test("run --worktree は --workspace が無ければ起動前に exit 2 で拒否する", () => {
  const t = setup();
  try {
    const sandboxCallsBefore = t.sandboxCalls().length;
    const result = t.run([...baseArgs(t.root, t.packet), "--worktree"], { FAKE_MODE: "ok" });

    assert.equal(result.code, 2);
    assert.match(result.json.errors.join("\n"), /--workspace が必要/);
    assert.equal(t.sandboxCalls().length, sandboxCallsBefore);
    assert.equal(t.execEnv(), null);
    assert.equal(fs.existsSync(path.join(t.taskDir, "worktree.json")), false);
  } finally { t.cleanup(); }
});

test(
  "run --worktree は帳簿と同じリポジトリの --workspace を exit 2 で拒否する",
  () => {
    const t = setup();
    try {
      const sandboxCallsBefore = t.sandboxCalls().length;
      const result = t.run(
        [...baseArgs(t.root, t.packet), "--workspace", t.root, "--worktree"],
        { FAKE_MODE: "ok" },
      );

      assert.equal(result.code, 2);
      assert.match(result.json.errors.join("\n"), /帳簿と別のリポジトリ/);
      assert.equal(t.sandboxCalls().length, sandboxCallsBefore);
      assert.equal(t.execEnv(), null);
      assert.equal(fs.existsSync(path.join(t.taskDir, "worktree.json")), false);
    } finally { t.cleanup(); }
  },
);

test(
  "削除済みで本体の外にある workspace は --worktree と混在扱いしない",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
      git(t.wsRepo, "add", "src/a/fixture.ts");
      git(t.wsRepo, "commit", "-qm", "track workspace target");

      const deletedWorkspace = path.join(t.base, "deleted-workspace");
      const entry = {
        kind: "run",
        step: "1",
        by: "runner",
        keys: { accepted: true, workspace: deletedWorkspace },
        text: "previous run",
      };
      const worklogModule = new URL("../worklog.mjs", import.meta.url).href;
      const script = `import { appendWorklog } from ${JSON.stringify(worklogModule)};\n`
        + `appendWorklog(${JSON.stringify(t.root)}, "T7", ${JSON.stringify(entry)});`;
      execFileSync(process.execPath, ["--input-type=module", "-e", script], {
        env: { ...process.env, XDG_STATE_HOME: path.join(t.base, "state") },
      });

      const result = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });

      assert.equal(result.code, 0, JSON.stringify(result.json));
      const mixedError = (result.json.errors ?? []).find(
        (error) => /branch なし accepted run がある/.test(error),
      );
      assert.equal(
        mixedError,
        undefined,
      );
    } finally { t.cleanup(); }
  },
);

test(
  "run --worktree は本体の同時変更を分離して worker の変更だけ gate に出す",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
      git(t.wsRepo, "add", "src/a/fixture.ts");
      git(t.wsRepo, "commit", "-qm", "track workspace target");

      const { code, json } = t.run(
        [...wsArgs(t), "--worktree"],
        { FAKE_MODE: "worktree-main-edit", FAKE_MAIN: t.ws },
      );

      assert.equal(code, 0, JSON.stringify(json));
      assert.equal(json.accepted, true);
      assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
      assert.equal(
        fs.readFileSync(path.join(t.ws, "top.ts"), "utf8"),
        "edited by another session\n",
      );
      assert.equal(
        fs.readFileSync(path.join(t.ws, "live.log"), "utf8"),
        "line1\nwritten by another process\n",
      );
      assert.equal(
        fs.readFileSync(path.join(t.ws, "fresh.log"), "utf8"),
        "created by another process\n",
      );
      assert.equal(
        fs.readFileSync(path.join(json.worktree.path, "src/a/impl.ts"), "utf8"),
        "impl\n",
      );
      assert.equal(fs.existsSync(path.join(t.ws, "src/a/impl.ts")), false);
    } finally { t.cleanup(); }
  },
);

test(
  "同じ T の後続 run は同じ worktree を使い前の変更を gate から外して残す",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
      git(t.wsRepo, "add", "src/a/fixture.ts");
      git(t.wsRepo, "commit", "-qm", "track workspace target");

      const firstArgs = [...wsArgs(t), "--worktree", "--allow", "src/a/first.ts"];
      const first = t.run(firstArgs, { FAKE_MODE: "worktree-first" });
      const stepIndex = firstArgs.indexOf("--step");
      const secondArgs = [
        ...firstArgs.slice(0, stepIndex + 1),
        "2",
        ...firstArgs.slice(stepIndex + 2),
        "--allow",
        "src/a/caller.ts",
      ];
      const second = t.run(secondArgs, { FAKE_MODE: "worktree-second" });

      assert.equal(first.code, 0, JSON.stringify(first.json));
      assert.equal(first.json.accepted, true);
      assert.equal(second.code, 0, JSON.stringify(second.json));
      assert.equal(second.json.accepted, true);
      assert.equal(second.json.worktree.path, first.json.worktree.path);
      assert.equal(second.json.worktree.branch, first.json.worktree.branch);
      assert.deepEqual(second.json.gate.changed, ["src/a/caller.ts"]);
      assert.ok(first.json.gate.changed.includes("src/a/first.ts"));
      assert.equal(second.json.gate.changed.includes("src/a/first.ts"), false);
      assert.equal(
        fs.readFileSync(path.join(first.json.worktree.path, "src/a/first.ts"), "utf8"),
        "first step\n",
      );
    } finally { t.cleanup(); }
  },
);

test(
  "作成後の前提検査で拒否された run は worktree を残す",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const args = [...baseArgs(t.root, t.packet)];
      args.splice(args.indexOf("--allow"), 2, "--allow", "other/y.ts");
      args.push("--workspace", t.ws, "--worktree");

      const result = t.run(args, { FAKE_MODE: "ok" });
      const record = JSON.parse(
        fs.readFileSync(path.join(t.taskDir, "worktree.json"), "utf8"),
      );

      assert.equal(result.code, 2);
      assert.match(result.json.errors.join("\n"), /T の対象の外/);
      assert.equal(fs.existsSync(record.path), true);
    } finally { t.cleanup(); }
  },
);

test(
  "run --worktree は report・run.json・worklog・状態行に branch を記録する",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
      git(t.wsRepo, "add", "src/a/fixture.ts");
      git(t.wsRepo, "commit", "-qm", "track workspace target");

      const result = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });
      const worktreeRecord = JSON.parse(
        fs.readFileSync(path.join(t.taskDir, "worktree.json"), "utf8"),
      );
      const runMeta = JSON.parse(
        fs.readFileSync(path.join(result.json.run_dir, "run.json"), "utf8"),
      );
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(result.json.run_dir, "snapshot.json"), "utf8"),
      );
      const expected = {
        repo: worktreeRecord.repo,
        path: worktreeRecord.path,
        branch: worktreeRecord.branch,
      };

      assert.equal(result.code, 0, JSON.stringify(result.json));
      assert.equal(result.json.accepted, true);
      assert.equal(worktreeRecord.repo, fs.realpathSync(t.wsRepo));
      assert.equal(worktreeRecord.path, fs.realpathSync(worktreeRecord.path));
      assert.deepEqual(snapshot.refScope, ["refs/heads/" + worktreeRecord.branch]);
      assert.deepEqual(Object.keys(result.json.worktree).sort(), ["branch", "path", "repo"]);
      assert.deepEqual(result.json.worktree, expected);
      assert.deepEqual(Object.keys(runMeta.worktree).sort(), ["branch", "path", "repo"]);
      assert.deepEqual(runMeta.worktree, expected);

      const runLines = worklogEntries(t, "run");
      assert.equal(runLines.length, 1);
      assert.ok(runLines[0].includes(`branch=${worktreeRecord.branch}`));

      for (const output of [result.stderr, fs.readFileSync(t.statusLog, "utf8")]) {
        const startLine = output.split("\n").find((line) => line.includes(" model=gpt-6-luna "));
        assert.ok(startLine, output);
        assert.ok(startLine.includes(` branch=${worktreeRecord.branch} `), startLine);
      }
    } finally { t.cleanup(); }
  },
);

test(
  "--worktree 無しの run は記録欄を出さず worktrees/ を作らない",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const result = t.run(wsArgs(t), { FAKE_MODE: "ok" });
      const runMeta = JSON.parse(
        fs.readFileSync(path.join(result.json.run_dir, "run.json"), "utf8"),
      );
      const snapshot = JSON.parse(
        fs.readFileSync(path.join(result.json.run_dir, "snapshot.json"), "utf8"),
      );
      const worktrees = path.join(
        t.base,
        "state",
        "claude-codex-worker",
        "worktrees",
      );

      assert.equal(result.code, 0, JSON.stringify(result.json));
      assert.equal(result.json.accepted, true);
      assert.equal(Object.hasOwn(result.json, "worktree"), false);
      assert.equal(Object.hasOwn(runMeta, "worktree"), false);
      assert.equal(Object.hasOwn(snapshot, "refScope"), false);
      assert.equal(worklogEntries(t, "run").length, 1);
      assert.doesNotMatch(worklogEntries(t, "run")[0], /(?:^|\s)branch=/);
      assert.equal(fs.existsSync(worktrees), false);

      for (const output of [result.stderr, fs.readFileSync(t.statusLog, "utf8")]) {
        const startLine = output.split("\n").find((line) => line.includes(" model=gpt-6-luna "));
        assert.ok(startLine, output);
        assert.doesNotMatch(startLine, / branch=/);
      }
    } finally { t.cleanup(); }
  },
);

test("integrate は worktree の commit を本体へ fast-forward して片付ける", () => {
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

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.deepEqual(
      Object.keys(integrated.json).sort(),
      ["branch", "commits", "head", "repo", "task"],
    );
    assert.equal(integrated.json.task, "T7");
    assert.equal(integrated.json.repo, fs.realpathSync(t.wsRepo));
    assert.equal(integrated.json.branch, record.branch);
    assert.equal(integrated.json.commits, 1);
    assert.equal(integrated.json.head, branchTip);
    assert.equal(git(t.wsRepo, "rev-parse", "HEAD").trim(), branchTip);
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), false);

    const lines = worklogEntries(t, "integrate");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(`branch=${record.branch}`), lines[0]);
    assert.ok(lines[0].includes("commits=1"), lines[0]);
  } finally { t.cleanup(); }
});

test("integrate は先行 commit が 0 件でも worktree を片付けて exit 0", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
    git(t.wsRepo, "add", "src/a/fixture.ts");
    git(t.wsRepo, "commit", "-qm", "track workspace target");
    const createArgs = [...baseArgs(t.root, t.packet)];
    createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
    createArgs.push("--workspace", t.ws, "--worktree");

    const created = t.run(createArgs, { FAKE_MODE: "ok" });

    assert.equal(created.code, 2);
    assert.equal(t.execEnv(), null, "前提検査で worker を起動しない");
    const recordPath = path.join(t.taskDir, "worktree.json");
    const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
    const worktreePath = fs.realpathSync(record.path);
    const mainHead = git(t.wsRepo, "rev-parse", "HEAD").trim();

    const integrated = t.run(["integrate", "--root", t.root, "--task", "T7"]);

    assert.equal(integrated.code, 0, JSON.stringify(integrated.json));
    assert.equal(integrated.json.commits, 0);
    assert.equal(integrated.json.head, mainHead);
    assert.equal(git(t.wsRepo, "rev-parse", "HEAD").trim(), mainHead);
    assert.equal(fs.existsSync(worktreePath), false);
    assert.equal(git(t.wsRepo, "branch", "--list", record.branch).trim(), "");
    assert.equal(fs.existsSync(recordPath), false);

    const lines = worklogEntries(t, "integrate");
    assert.equal(lines.length, 1);
    assert.ok(lines[0].includes(`branch=${record.branch}`), lines[0]);
    assert.ok(lines[0].includes("commits=0"), lines[0]);
  } finally { t.cleanup(); }
});

/** Create a clean registered worktree without starting the fake worker.
 * @param {ReturnType<typeof setup>} t Test fixture.
 * @returns {{
 *   record: { repo: string, path: string, branch: string, base: string,
 *     base_ref: string, created_at: string },
 *   worktreePath: string
 * }} Worktree state.
 */
