// codex-worker の cli の試験: --workspace(帳簿と別のリポジトリを作業場所にする run)とロックの単位。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  git,
  todoWithTarget,
  setup,
  baseArgs,
  waitFor,
  wsArgs,
  worklogEntries,
} from "./cli-harness.mjs";

test("run --workspace は worker の起動とゲートを作業場所で行い、記録を帳簿の root に残す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { code, json } = t.run(wsArgs(t), { FAKE_MODE: "ok" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.accepted, true);
    assert.equal(json.workspace, t.ws);
    assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
    assert.equal(fs.readFileSync(path.join(t.ws, "src/a/impl.ts"), "utf8"), "impl\n");
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);

    const meta = JSON.parse(fs.readFileSync(path.join(json.run_dir, "run.json"), "utf8"));
    assert.equal(meta.root, t.root);
    assert.equal(meta.workspace, t.ws);
    assert.ok(worklogEntries(t, "run").some((line) => line.includes(`workspace=${t.ws} `)));
    assert.deepEqual(t.locks(), []);
  } finally { t.cleanup(); }
});

test("run --workspace は作業場所の許可外の変更を戻し、帳簿の root には触らない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { code, json } = t.run(wsArgs(t), { FAKE_MODE: "violate" });

    assert.equal(code, 1);
    assert.deepEqual(json.gate.violations, ["other/y.ts"]);
    assert.equal(fs.readFileSync(path.join(t.ws, "other/y.ts"), "utf8"), "y1\n");
    assert.equal(git(t.root, "status", "--porcelain"), "");
  } finally { t.cleanup(); }
});

test("run --workspace は git でない作業場所と、root と入れ子の作業場所を起動前に拒否する", () => {
  const t = setup({ workspace: "repo" });
  try {
    const runIn = (workspace) =>
      t.run([...baseArgs(t.root, t.packet), "--workspace", workspace], { FAKE_MODE: "ok" });

    let result = runIn(path.join(t.base, "bin"));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /git のリポジトリではない/);

    fs.mkdirSync(path.join(t.root, "inner"));
    git(path.join(t.root, "inner"), "init", "-q");
    result = runIn(path.join(t.root, "inner"));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /入れ子/);
  } finally { t.cleanup(); }
});

test("verify は作業場所で検証節のコマンドを打ち、結果を帳簿の root の作業記録に残す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const ran = t.run(wsArgs(t), { FAKE_MODE: "ok" });

    const verified = t.run(["verify", "--run", ran.json.run_dir]);

    assert.equal(verified.json.commands[0].exit_code, 0, "作業場所に worker の変更がある");
    assert.equal(verified.json.root, t.root);
    assert.equal(verified.json.workspace, t.ws);
    assert.equal(t.sandboxCalls().at(-1).cwd, t.ws);
    assert.equal(worklogEntries(t, "verify").length, 1);
  } finally { t.cleanup(); }
});

test("resume は作業場所の未コミットの変更も照合し、説明できないものを絶対パスで挙げる", () => {
  const t = setup({ workspace: "repo" });
  try {
    fs.appendFileSync(path.join(t.ws, "other/y.ts"), "起動前からの変更\n");
    t.run(wsArgs(t), { FAKE_MODE: "ok" });
    let resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, []);
    assert.deepEqual(resumed.json.workspaces, [
      { workspace: t.ws, dirty: ["other/y.ts", "src/a/impl.ts"], unexplained_dirty: [] },
    ]);

    fs.writeFileSync(path.join(t.ws, "src/a/stray.ts"), "誰の変更か分からない\n");
    resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);

    assert.deepEqual(resumed.json.unexplained_dirty, [path.join(t.ws, "src/a/stray.ts")]);
  } finally { t.cleanup(); }
});

test("run --workspace のサブディレクトリでは、ゲートはその中だけを見て外を戻さない", () => {
  const t = setup({ workspace: "subdir" });
  try {
    const { code, json } = t.run(wsArgs(t), { FAKE_MODE: "outside" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
    const read = (file) => fs.readFileSync(path.join(t.wsRepo, file), "utf8");
    assert.equal(read("live.log"), "line1\nwritten by another process\n");
    assert.equal(read("top.ts"), "edited by another session\n");
  } finally { t.cleanup(); }
});

test("run --workspace は .gitignore 対象のファイルの変化を違反にせず警告に出し、戻さない", () => {
  const t = setup({ workspace: "repo" });
  try {
    const { code, json } = t.run(wsArgs(t), { FAKE_MODE: "ignored" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.gate.ignored_files, [".env"]);
    assert.match(json.warnings.join(), /\.gitignore 対象のファイルが変わった.*\.env/);
    assert.equal(fs.readFileSync(path.join(t.ws, ".env"), "utf8"), "SECRET=changed\n");
  } finally { t.cleanup(); }
});

test("run は --workspace が無ければ .gitignore 対象のファイルの変化を従来どおり違反にする", () => {
  const t = setup();
  try {
    fs.writeFileSync(path.join(t.root, ".gitignore"), ".env\n");
    git(t.root, "add", ".gitignore");
    git(t.root, "commit", "-qm", "ignore");

    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ignored" });

    assert.equal(code, 1);
    assert.deepEqual(json.gate.violations, [".env"]);
    const envExists = fs.existsSync(path.join(t.root, ".env"));
    assert.equal(envExists, false, "許可外の新しいファイルは消して戻す");
  } finally { t.cleanup(); }
});

test("run --workspace は ~ と絶対パスの --allow を作業場所からの相対に直して使う", () => {
  const t = setup({ workspace: "repo" });
  try {
    const args = ["run", "--root", t.root, "--task", "T7", "--step", "1", "--packet", t.packet,
      "--allow", path.join(t.ws, "src/a/impl.ts"), "--workspace", t.ws];

    const { code, json } = t.run(args, { FAKE_MODE: "ok" });

    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
    const meta = JSON.parse(fs.readFileSync(path.join(json.run_dir, "run.json"), "utf8"));
    assert.deepEqual(meta.allow, ["src/a/impl.ts"]);
  } finally { t.cleanup(); }
});

test("シグナルで止められた --workspace の run も作業場所を記録し、resume が照合する", async () => {
  const t = setup({ workspace: "repo" });
  try {
    const pidFile = path.join(t.base, "grandchild.pid");
    const child = t.spawnRun(wsArgs(t), { FAKE_MODE: "sleep", FAKE_PID_FILE: pidFile });
    await waitFor(() => t.locks().length > 0 && fs.existsSync(pidFile));
    fs.writeFileSync(path.join(t.ws, "src/a/half.ts"), "途中まで書いた\n");

    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));

    assert.ok(worklogEntries(t, "run").some((line) => line.includes(`workspace=${t.ws} `)));
    const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, [path.join(t.ws, "src/a/half.ts")]);
  } finally { t.cleanup(); }
});

test("同じリポジトリの worker は、作業場所が違っても同時に走らせない", async () => {
  const t = setup({ workspace: "subdir" });
  try {
    const pidFile = path.join(t.base, "grandchild.pid");
    const child = t.spawnRun(wsArgs(t), { FAKE_MODE: "sleep", FAKE_PID_FILE: pidFile });
    await waitFor(() => t.locks().length > 0 && fs.existsSync(pidFile));

    // 別の帳簿として、作業場所のリポジトリ自身を root にした run(dotfiles の中のタスクに当たる)
    fs.writeFileSync(path.join(t.wsRepo, "TODO.md"), todoWithTarget("pkg/src/a/"));
    const args = ["run", "--root", t.wsRepo, "--task", "T7", "--step", "1", "--packet", t.packet,
      "--allow", "pkg/src/a/impl.ts"];
    const second = t.run(args, { FAKE_MODE: "ok" });

    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));
    assert.equal(second.code, 2);
    assert.match(second.json.errors.join(), /別の worker が実行中/);
  } finally { t.cleanup(); }
});

test("run は --root が git でなく --allow が絶対パスでも、JSON の誤りを出して exit 2", () => {
  const t = setup();
  try {
    const args = ["run", "--root", t.base, "--task", "T7", "--step", "1", "--packet", t.packet,
      "--allow", path.join(t.root, "src/a/impl.ts")];

    const result = t.run(args);

    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /git のリポジトリではない/);
  } finally { t.cleanup(); }
});
