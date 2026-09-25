// runner(cli.mjs)の run / restore の流れを、偽の codex で確かめる(本物の codex は起動しない)
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

// 検証節: 1 本目は worker の変更があれば通り、2 本目は必ず落ちる。束ねて打つと 1 本目の成否が分からなくなる組み合わせ
const VERIFY_SECTION = "## 検証\n- `test -f src/a/impl.ts` (worker の変更がある)\n- `echo checked; exit 3`\n";

const PLAN = "# T7 のステップ\n\n- s1: impl を書く\n- s2: 呼び出し元を直す\n";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// 偽の codex: `debug models` は一覧を返す。`exec` は FAKE_MODE に従って作業ツリーを変え、結果と rollout を書く。
// `sandbox` は呼ばれ方を記録し、疎通の検査には FAKE_SANDBOX に従った判定を返し、それ以外のコマンドはそのまま打つ
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "sandbox") {
  const rest = args.slice(args.indexOf("--") + 1);
  fs.appendFileSync(path.join(process.env.CODEX_HOME, "sandbox-calls.jsonl"), JSON.stringify({
    args, cwd: process.cwd(), uv: process.env.UV_CACHE_DIR ?? null, uvExists: !!process.env.UV_CACHE_DIR && fs.existsSync(process.env.UV_CACHE_DIR),
  }) + "\\n");
  if (rest.join(" ").includes("CODEX_WORKER_SANDBOX_PROBE")) {
    const mode = process.env.FAKE_SANDBOX ?? "ok";
    console.log(mode === "closed" ? "LOOPBACK=denied EPERM" : "LOOPBACK=ok");
    console.log(mode === "open" ? "EXTERNAL=reached" : "EXTERNAL=blocked EPERM");
    process.exit(0);
  }
  const r = spawnSync(rest[0], rest.slice(1), { stdio: "inherit" });
  process.exit(r.status ?? 1);
}
if (args[0] === "debug" && args[1] === "models") {
  process.stdout.write(JSON.stringify({ models: [{ slug: "gpt-5.6-luna" }, { slug: "gpt-6-luna" }, { slug: "gpt-6-sol" }] }));
  process.exit(0);
}
const root = args[args.indexOf("-C") + 1];
const out = args[args.indexOf("-o") + 1];
const mode = process.env.FAKE_MODE;
const uv = process.env.UV_CACHE_DIR ?? null;
fs.writeFileSync(path.join(process.env.CODEX_HOME, "exec-env.json"), JSON.stringify({ uv, uvExists: !!uv && fs.existsSync(uv) }));
const id = "0000-" + process.pid;
console.log(JSON.stringify({ type: "thread.started", thread_id: id }));
const d = new Date();
const day = path.join(process.env.CODEX_HOME, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"));
fs.mkdirSync(day, { recursive: true });
fs.writeFileSync(path.join(day, "rollout-x-" + id + ".jsonl"), JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: 20000 }, model_context_window: 200000 } } }) + "\\n");
if (mode === "sleep") {
  const grandchild = spawn("sleep", ["30"], { stdio: "ignore" });
  fs.writeFileSync(process.env.FAKE_PID_FILE, String(grandchild.pid));
  setTimeout(() => {}, 60000);
  return;
}
if (mode === "chunked") {
  const splitLine = Buffer.from('{"type":"message","text":"é"}\\n');
  const splitAt = splitLine.indexOf(Buffer.from("é")) + 1;
  process.stdout.write(splitLine.subarray(0, splitAt));
  setTimeout(() => {
    process.stdout.write(splitLine.subarray(splitAt));
    process.stdout.write(Buffer.from('{"type":"message","text":"末尾"}'));
  }, 50);
  return;
}
if (mode === "timing" || mode === "timing-timeout") {
  const timingEvents = [
    {
      type: "item.started",
      item: {
        id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
      },
    },
    {
      type: "item.completed",
      item: {
        id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
        exit_code: 0,
      },
    },
    {
      type: "item.started",
      item: { id: "other-1", type: "command_execution", command: "sed -n 1p README.md" },
    },
    {
      type: "item.completed",
      item: {
        id: "other-1", type: "command_execution", command: "sed -n 1p README.md",
        exit_code: 0,
      },
    },
    {
      type: "item.started",
      item: { id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts" },
    },
    {
      type: "item.completed",
      item: {
        id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts",
        exit_code: 0,
      },
    },
    { type: "message", text: "多バイト文字 é" },
  ];
  if (mode === "timing-timeout") {
    console.log(JSON.stringify(timingEvents[0]));
    setTimeout(() => {}, 60000);
    return;
  }
  process.stdout.write("\\nnot-json\\n");
  for (const event of timingEvents) console.log(JSON.stringify(event));
}
console.log(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'" } }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'", exit_code: 0 } }));
fs.writeFileSync(path.join(root, "src/a/impl.ts"), "impl\\n");
console.log(JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: path.join(root, "src/a/impl.ts"), kind: "add" }] } }));
if (mode === "violate") fs.writeFileSync(path.join(root, "other/y.ts"), "changed by worker\\n");
if (mode === "outside") {
  fs.appendFileSync(path.join(root, "..", "live.log"), "written by another process\\n");
  fs.writeFileSync(path.join(root, "..", "top.ts"), "edited by another session\\n");
}
if (mode === "ignored") fs.writeFileSync(path.join(root, ".env"), "SECRET=changed\\n");
if (mode === "worktree-main-edit") {
  const main = process.env.FAKE_MAIN;
  fs.writeFileSync(path.join(main, "top.ts"), "edited by another session\\n");
  fs.appendFileSync(path.join(main, "live.log"), "written by another process\\n");
  fs.writeFileSync(path.join(main, "fresh.log"), "created by another process\\n");
}
if (mode === "worktree-second") {
  fs.writeFileSync(path.join(root, "src/a/caller.ts"), "caller\\n");
}
if (mode === "worktree-first") {
  fs.writeFileSync(path.join(root, "src/a/first.ts"), "first step\\n");
}
fs.writeFileSync(out, JSON.stringify({ status: "done", changed_files: ["src/a/impl.ts"], tests_run: [], criteria: [], holes: [], reference_errors: [], notes: "" }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }));
`;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
}

// src/a/ と other/y.ts を持つリポジトリを作る(worker が書く側)
function initCodeRepo(dir) {
  fs.mkdirSync(path.join(dir, "src/a"), { recursive: true });
  fs.mkdirSync(path.join(dir, "other"), { recursive: true });
  git(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "other/y.ts"), "y1\n");
}

// T7 の行と、対象が target の完了条件ブロックを持つ TODO.md
const todoWithTarget = (target) =>
  `| #1-1 | T7 | x | 中 | — | [ ] |\n\n**#1-1 / T7** — 完了条件: 対象: \`${target}\`。\n`;

// 作業場所のリポジトリ wsrepo: .gitignore(*.log と .env)・追跡中の top.ts・ほかのプロセスが
// 書き続ける live.log を最上位に持つ(dotfiles の history.jsonl などを写す)。コードは codeDir に置く
function initWorkspaceRepo(wsRepo, codeDir) {
  initCodeRepo(wsRepo);

  fs.mkdirSync(path.join(codeDir, "src/a"), { recursive: true });
  fs.mkdirSync(path.join(codeDir, "other"), { recursive: true });
  fs.writeFileSync(path.join(codeDir, "other/y.ts"), "y1\n");
  fs.writeFileSync(path.join(wsRepo, ".gitignore"), "*.log\n.env\n");
  fs.writeFileSync(path.join(wsRepo, "top.ts"), "t1\n");
  git(wsRepo, "add", "-A");
  git(wsRepo, "commit", "-qm", "init");

  fs.writeFileSync(path.join(wsRepo, "live.log"), "line1\n");
  fs.writeFileSync(path.join(codeDir, ".env"), "SECRET=original\n");
}

// workspace: "repo" なら、帳簿(TODO.md)の root とは別のリポジトリ wsrepo を worker の
// 作業場所にする。
// "subdir" なら wsrepo の中の pkg を作業場所にする。どちらも T の対象を HOME からの ~ で書く
// (~/.claude が dotfiles を指す構成を写す)
function setup({ workspace = null } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-cli-")));
  const root = path.join(base, "repo");
  const wsRepo = path.join(base, "wsrepo");
  const ws = { repo: wsRepo, subdir: path.join(wsRepo, "pkg") }[workspace] ?? root;

  initCodeRepo(root);
  const target = workspace ? `~/${path.relative(base, ws)}/src/a/` : "src/a/";
  fs.writeFileSync(path.join(root, "TODO.md"), todoWithTarget(target));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");

  if (workspace) initWorkspaceRepo(wsRepo, ws);

  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "codex"), FAKE_CODEX, { mode: 0o755 });
  const home = path.join(base, "worker-home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.toml"), "");
  fs.writeFileSync(path.join(base, "auth.json"), "{}");
  fs.symlinkSync(path.join(base, "auth.json"), path.join(home, "auth.json"));
  const packet = path.join(base, "packet.md");
  fs.writeFileSync(packet, `## 目的\nimpl を書く\n\n## 横断の確認\n該当なし: 許可パス内で閉じる試験用の変更\n\n${VERIFY_SECTION}`);
  const tmp = path.join(base, "tmp");
  fs.mkdirSync(tmp);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_WORKER_HOME: home, TMPDIR: tmp,
    XDG_STATE_HOME: path.join(base, "state"), ...(workspace ? { HOME: base } : {}),
  };
  const run = (args, extraEnv = {}) => {
    const result = spawnSync("node", [cli, ...args], { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 60000 });
    return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };
  // 終わるのを待たずに起動する(シグナルで止める試験のため)
  const spawnRun = (args, extraEnv = {}) =>
    spawn("node", [cli, ...args], { env: { ...env, ...extraEnv }, stdio: "ignore" });
  const lockDir = path.join(tmp, "claude-task-scope");
  const locks = () => (fs.existsSync(lockDir) ? fs.readdirSync(lockDir).filter((n) => n.startsWith("worker-lock-")) : []);
  const statusLog = path.join(base, "state", "claude-codex-worker", "status", `${root.replace(/[^A-Za-z0-9]/g, "-")}.log`);
  const taskDir = path.join(base, "state", "claude-codex-worker", "tasks", root.replace(/[^A-Za-z0-9]/g, "-"), "T7");
  const plan = path.join(base, "plan.md");
  const registerPlan = (text) => {
    fs.writeFileSync(plan, text);
    return run(["plan", "--root", root, "--task", "T7", "--file", plan]);
  };
  const show = () => spawnSync("node", [cli, "show", "--root", root, "--task", "T7"], { env, encoding: "utf8" });
  registerPlan(PLAN);
  const sandboxCalls = () => {
    const file = path.join(home, "sandbox-calls.jsonl");
    return fs.existsSync(file) ? fs.readFileSync(file, "utf8").trimEnd().split("\n").map((l) => JSON.parse(l)) : [];
  };
  const execEnv = () => {
    const file = path.join(home, "exec-env.json");
    return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  };
  return {
    base, root, ws, wsRepo, packet, run, spawnRun, locks, statusLog, taskDir, registerPlan, show,
    tmp, sandboxCalls,
    execEnv,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

const baseArgs = (root, packet) => ["run", "--root", root, "--task", "T7", "--step", "1", "--packet", packet, "--allow", "src/a/impl.ts"];

const assertStatusLogLines = (log) => {
  const statusLine = /^\[Codex [^\]]*\] \d{2}:\d{2}:\d{2} /;
  assert.ok(log.trimEnd().split("\n").every((line) => statusLine.test(line)), log);
};

test("正常な run は exit 0 で、系統名から最新のモデルを解決し、ロックを外す", () => {
  const t = setup();
  try {
    const { code, json, stderr } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.accepted, true);
    assert.equal(json.model, "gpt-6-luna");
    assert.equal(json.model_family, "luna");
    assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
    assert.equal(json.metrics.peak_ratio, 0.1);
    assert.deepEqual(t.locks(), []);
    assert.ok(json.run_dir.startsWith(path.join(t.base, "state")), "run の記録は worker が書ける TMPDIR の外に置く");
    // 状態行は stderr と共有ログにだけ出る(stdout は report の JSON だけ。上の JSON.parse が通ることで確かめている)
    const expected = [
      "$ npm test", "  ✓ npm test", "edit: src/a/impl.ts (add)",
      "tokens: input=10 cached=0 output=5", "finished: accepted worker=done changed=1",
    ];
    for (const out of [stderr, fs.readFileSync(t.statusLog, "utf8")]) {
      for (const line of expected) assert.ok(out.includes(line), `${line} が無い:\n${out}`);
      assert.match(out, /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} model=gpt-6-luna /m);
    }
    assertStatusLogLines(stderr);
    assertStatusLogLines(fs.readFileSync(t.statusLog, "utf8"));
  } finally { t.cleanup(); }
});

test("許可外の変更は exit 1 で、その分だけ戻し、許可内の変更は残す", () => {
  const t = setup();
  try {
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "violate" });
    assert.equal(code, 1);
    assert.deepEqual(json.gate.violations, ["other/y.ts"]);
    assert.deepEqual(json.restore.restored, ["other/y.ts"]);
    assert.equal(fs.readFileSync(path.join(t.root, "other/y.ts"), "utf8"), "y1\n");
    assert.equal(fs.readFileSync(path.join(t.root, "src/a/impl.ts"), "utf8"), "impl\n");
    assert.equal(fs.readFileSync(json.restore.backups["other/y.ts"], "utf8"), "changed by worker\n");
  } finally { t.cleanup(); }
});

test("タイムアウトはプロセスグループごと止め、全変更を戻してロックを外す", () => {
  const t = setup();
  const pidFile = path.join(t.base, "grandchild.pid");
  try {
    const { code, json } = t.run([...baseArgs(t.root, t.packet), "--timeout", "1"], { FAKE_MODE: "sleep", FAKE_PID_FILE: pidFile });
    assert.equal(code, 1);
    assert.match(json.reasons.join(), /タイムアウト/);
    assert.deepEqual(t.locks(), []);
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(grandchild, 0), /ESRCH/, "codex が起動した子プロセスも止まっている");
  } finally { t.cleanup(); }
});

test("起動前の拒否は exit 2 で JSON を出し、worker を起動しない", () => {
  const t = setup();
  try {
    fs.writeFileSync(t.packet, "x".repeat(13 * 1024));
    let result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /上限/);
    fs.writeFileSync(t.packet, "ok");
    result = t.run([...baseArgs(t.root, t.packet), "--allow", "src/a/2", "--allow", "src/a/3", "--allow", "src/a/4"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /許可パスが 4 件/);
    result = t.run(["run", "--root", t.base, "--task", "T7", "--step", "1", "--packet", t.packet, "--allow", "x"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /git のリポジトリではない/);
    fs.writeFileSync(t.packet, `## 目的\nimpl を書く\n\n## 横断の確認\n該当なし: 試験用\n\n${VERIFY_SECTION}`);
    result = t.run([...baseArgs(t.root, t.packet), "--model-family", "nova"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /系統 nova/);
    fs.writeFileSync(t.packet, "## 目的\nimpl を書く\n");
    result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /## 横断の確認/);
    assert.match(result.json.errors.join(), /## 検証/);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);
  } finally { t.cleanup(); }
});

test("restore は run の許可パスの中だけを戻し、記録が無ければ exit 2", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    fs.appendFileSync(path.join(t.root, "TODO.md"), "監督の追記\n");
    const restored = t.run(["restore", "--run", json.run_dir]);
    assert.equal(restored.code, 0);
    assert.deepEqual(restored.json.restore.restored, ["src/a/impl.ts"]);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);
    assert.match(fs.readFileSync(path.join(t.root, "TODO.md"), "utf8"), /監督の追記/);
    assert.equal(t.run(["restore", "--run", path.join(t.base, "missing")]).code, 2);
  } finally { t.cleanup(); }
});

test("verify は packet の検証節のコマンドを 1 本ずつ打ち、コマンドごとの終了コードを返す", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const verified = t.run(["verify", "--run", json.run_dir]);
    assert.equal(verified.code, 1, "0 でないコマンドがあれば exit 1");
    assert.equal(verified.json.all_passed, false);
    assert.deepEqual(verified.json.commands.map((c) => [c.command, c.exit_code]), [
      ["test -f src/a/impl.ts", 0], ["echo checked; exit 3", 3],
    ]);
    assert.equal(verified.json.commands[1].tail, "checked");
    assert.equal(fs.readFileSync(verified.json.commands[1].log, "utf8"), "checked\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(json.run_dir, "verify.json"), "utf8")), verified.json);
    const verifyLines = [
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify \$ test -f src\/a\/impl\.ts$/m,
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify   ✗ exit 3$/m,
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify finished: 1\/2 ok$/m,
    ];
    for (const line of ["verify $ test -f src/a/impl.ts", "verify   ✗ exit 3", "verify finished: 1/2 ok"]) {
      assert.ok(verified.stderr.includes(line), `${line} が無い:\n${verified.stderr}`);
    }
    for (const out of [verified.stderr, fs.readFileSync(t.statusLog, "utf8")]) {
      for (const line of verifyLines) assert.match(out, line);
    }
    assertStatusLogLines(verified.stderr);
    assertStatusLogLines(fs.readFileSync(t.statusLog, "utf8"));

    // 検証を打つ時点の作業ツリーを見る(worker の変更を戻せば 1 本目も落ちる)
    fs.writeFileSync(path.join(json.run_dir, "packet.md"), "## 検証\n- `test -f src/a/impl.ts`\n");
    assert.equal(t.run(["verify", "--run", json.run_dir]).code, 0);
    fs.rmSync(path.join(t.root, "src/a/impl.ts"));
    assert.equal(t.run(["verify", "--run", json.run_dir]).json.commands[0].exit_code, 1);
  } finally { t.cleanup(); }
});

test("run は worker の sandbox が loopback だけを通すと確かめられない時、worker を起動せず exit 2", () => {
  for (const [mode, pattern] of [["closed", /loopback/], ["open", /外部/]]) {
    const t = setup();
    try {
      const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok", FAKE_SANDBOX: mode });
      assert.equal(code, 2, `${mode}: ${JSON.stringify(json)}`);
      assert.equal(json.stage, "preflight");
      assert.match(json.errors.join(), pattern);
      assert.equal(t.execEnv(), null, `${mode}: worker を起動していない`);
    } finally { t.cleanup(); }
  }
});

test("run は worker に TMPDIR の下の run 専用の uv キャッシュを渡し、終わったら消す", () => {
  const t = setup();
  try {
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(code, 0, JSON.stringify(json));
    const env = t.execEnv();
    assert.ok(env.uv?.startsWith(t.tmp + path.sep), `TMPDIR の下: ${env.uv}`);
    assert.ok(env.uv.includes(json.run_id), `run ごとに分かれる: ${env.uv}`);
    assert.equal(env.uvExists, true, "worker の起動時には在る");
    assert.equal(fs.existsSync(env.uv), false, "run の後は消えている");
  } finally { t.cleanup(); }
});

test("verify は各コマンドを worker と同じ sandbox(codex sandbox)の中で、専用の uv キャッシュで打つ", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const before = t.sandboxCalls().length;
    const verified = t.run(["verify", "--run", json.run_dir]);
    assert.equal(verified.code, 1, JSON.stringify(verified.json));
    const calls = t.sandboxCalls().slice(before).filter((c) => !c.args.join(" ").includes("CODEX_WORKER_SANDBOX_PROBE"));
    assert.deepEqual(calls.map((c) => c.args.slice(c.args.indexOf("--") + 1)), [
      ["/bin/sh", "-c", "test -f src/a/impl.ts"], ["/bin/sh", "-c", "echo checked; exit 3"],
    ]);
    for (const call of calls) {
      assert.deepEqual(call.args.slice(0, call.args.indexOf("--")), ["sandbox", "-c", 'sandbox_mode="workspace-write"']);
      assert.equal(call.cwd, t.root);
      assert.ok(call.uv?.startsWith(t.tmp + path.sep) && call.uvExists, `専用の uv キャッシュ: ${call.uv}`);
      assert.equal(fs.existsSync(call.uv), false, "verify の後は消えている");
    }
  } finally { t.cleanup(); }
});

test("verify は sandbox が loopback だけを通すと確かめられない時、何も打たず exit 2", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const result = t.run(["verify", "--run", json.run_dir], { FAKE_SANDBOX: "open" });
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /外部/);
    assert.equal(fs.existsSync(path.join(json.run_dir, "verify.json")), false);
  } finally { t.cleanup(); }
});

test("verify は記録が無い・検証節が無い run では何も打たず exit 2", () => {
  const t = setup();
  try {
    assert.equal(t.run(["verify", "--run", path.join(t.base, "missing")]).code, 2);
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    fs.writeFileSync(path.join(json.run_dir, "packet.md"), "## 検証\nコマンドは後で\n");
    const result = t.run(["verify", "--run", json.run_dir]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /## 検証/);
    assert.equal(fs.existsSync(path.join(json.run_dir, "verify.json")), false);
  } finally { t.cleanup(); }
});

test("plan は計画を登録し、登録し直すと前の計画を残して、一覧を状態行に出す", () => {
  const t = setup();
  try {
    const revised = t.registerPlan("- s1: impl を書く\n- s2: 呼び出し元を直す\n- s3: 文書を直す\n");
    assert.equal(revised.code, 0, JSON.stringify(revised.json));
    assert.equal(revised.json.revised, true);
    assert.deepEqual(revised.json.steps.map((s) => s.step), ["1", "2", "3"]);
    assert.equal(fs.readdirSync(t.taskDir).filter((n) => /^plan-.*\.md$/.test(n)).length, 1, "前の計画が残る");
    const log = fs.readFileSync(t.statusLog, "utf8");
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2} plan registered: 2 steps /m);
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2} plan revised: 3 steps /m);
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2}   s3: 文書を直す$/m);
    assertStatusLogLines(revised.stderr);
    assertStatusLogLines(log);

    for (const bad of ["ステップは後で\n", "- s1: a\n- s1: b\n", "- s1:\n"]) {
      assert.equal(t.registerPlan(bad).code, 2, bad);
    }
    assert.match(fs.readFileSync(path.join(t.taskDir, "plan.md"), "utf8"), /s3: 文書を直す/, "拒否した計画で上書きしない");
  } finally { t.cleanup(); }
});

test("run は計画が無いタスクと計画に無いステップを起動せず、計画があれば全体の何番目かと目的を出す", () => {
  const t = setup();
  try {
    let result = t.run(baseArgs(t.root, t.packet).map((a, i) => (i === 6 ? "3" : a)));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /ステップ 3 が T7 の計画/);
    fs.rmSync(t.taskDir, { recursive: true });
    result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /T7 のステップ計画が無い/);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);

    t.registerPlan(PLAN);
    result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} started: impl を書く$/m);
    assert.equal(fs.readFileSync(path.join(t.taskDir, "s1.packet.md"), "utf8"), fs.readFileSync(t.packet, "utf8"));
  } finally { t.cleanup(); }
});

test("show は計画の各ステップの最新の run の状態と verify の結果を並べる", () => {
  const t = setup();
  try {
    let out = t.show();
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^1\/2 s1 +未着手 +impl を書く$/m);

    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]); // 古い run の verify は最新の run の欄に出ない
    out = t.show();
    assert.match(out.stdout, /^1\/2 s1 +accepted\(done\) ×2 +impl を書く$/m);
    assert.match(out.stdout, /^2\/2 s2 +未着手 +呼び出し元を直す$/m);
    assert.ok(out.stdout.includes(path.join(t.taskDir, "plan.md")));

    const latest = fs.readdirSync(path.join(t.base, "state", "claude-codex-worker", "runs")).sort().at(-1);
    t.run(["verify", "--run", path.join(t.base, "state", "claude-codex-worker", "runs", latest)]);
    assert.match(t.show().stdout, /^1\/2 s1 +accepted\(done\) ×2 +verify 1 件失敗 +impl を書く$/m);

    fs.rmSync(t.taskDir, { recursive: true });
    assert.equal(t.show().status, 2);
  } finally { t.cleanup(); }
});

const readLog = (t) => fs.readFileSync(path.join(t.taskDir, "worklog.md"), "utf8");

test("plan・run・verify は結果を worklog に 1 行ずつ残し、最初の run だけが起動前の未コミットを baseline に持つ", () => {
  const t = setup();
  try {
    fs.appendFileSync(path.join(t.root, "other/y.ts"), "利用者の作業中の変更\n");
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]);
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const log = readLog(t);
    assert.match(log, /^- \S+ kind=plan by=runner steps=2 revised=false — s1 impl を書く \/ s2 呼び出し元を直す$/m);
    const runs = log.split("\n").filter((l) => l.includes("kind=run"));
    assert.equal(runs.length, 2);
    assert.match(runs[0], / step=s1 by=runner run=T7-s1-\S+ accepted=true worker=done changed=src\/a\/impl.ts baseline=other\/y.ts — accepted: impl を書く$/);
    assert.doesNotMatch(runs[1], /baseline=/);
    assert.match(log, new RegExp(`kind=verify step=s1 by=runner run=${path.basename(json.run_dir)} result=fail:1 — 1/2 ok`));
  } finally { t.cleanup(); }
});

test("show は run の記録が消えたステップを worklog から出し、--json で同じ内容を返す", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]);
    fs.rmSync(path.join(t.base, "state", "claude-codex-worker", "runs"), { recursive: true });
    assert.match(t.show().stdout, /^1\/2 s1 +accepted\(done\) +verify 1 件失敗 +impl を書く$/m);
    const shown = t.run(["show", "--root", t.root, "--task", "T7", "--json"]);
    assert.equal(shown.code, 0);
    assert.deepEqual(shown.json.steps.map((s) => [s.step, s.state, s.verify, s.source]), [
      ["1", "accepted(done)", "verify 1 件失敗", "worklog"], ["2", "未着手", "", null],
    ]);
  } finally { t.cleanup(); }
});

test("note は種別と本文を検査して worklog に追記し、--changed auto で未コミットのパスを埋める", () => {
  const t = setup();
  try {
    assert.equal(t.run(["note", "--root", t.root, "--task", "T7", "--kind", "budget", "--text", "x"]).code, 2, "hook の種別は note で書かない");
    assert.equal(t.run(["note", "--root", t.root, "--task", "T7", "--kind", "fact", "--text", " "]).code, 2, "本文が空");
    const fact = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "decision", "--step", "1", "--text", "戻り値は配列にする(呼び出し元 2 か所が反復するため)"]);
    assert.equal(fact.code, 0, JSON.stringify(fact.json));
    fs.writeFileSync(path.join(t.root, "src/a/new.ts"), "x\n");
    const step = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "step", "--step", "s1", "--changed", "auto", "--text", "s1 の検証が通った"]);
    assert.equal(step.code, 0);
    const log = readLog(t);
    assert.match(log, /kind=decision step=s1 by=claude — 戻り値は配列にする\(呼び出し元 2 か所が反復するため\)$/m);
    assert.match(log, /kind=step step=s1 by=claude changed=src\/a\/new.ts — s1 の検証が通った$/m);
    const resume = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "resume", "--from", "2", "--text", "s2 から"], { CODEX_THREAD_ID: "abcdef1234567" });
    assert.match(resume.json.entry, /kind=resume by=codex:abcdef12 from=s2 — s2 から$/);
  } finally { t.cleanup(); }
});

test("resume は作業記録で説明できない未コミットの変更だけを unexplained_dirty に挙げる", () => {
  const t = setup();
  try {
    let resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.equal(resumed.code, 0);
    assert.equal(resumed.json.exists, true, "計画の登録で worklog ができる");
    assert.deepEqual(resumed.json.unexplained_dirty, []);

    fs.appendFileSync(path.join(t.root, "other/y.ts"), "起動前からの変更\n");
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" }); // 受け入れた run の変更 src/a/impl.ts と baseline の other/y.ts
    fs.appendFileSync(path.join(t.root, "TODO.md"), "状態文書\n");
    t.run(["note", "--root", t.root, "--task", "T7", "--kind", "handoff", "--step", "2", "--text", "s2 の途中で予算停止"]);
    resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.dirty.sort(), ["TODO.md", "other/y.ts", "src/a/impl.ts"]);
    assert.deepEqual(resumed.json.unexplained_dirty, []);
    assert.equal(resumed.json.last_handoff.text, "s2 の途中で予算停止");
    assert.equal(resumed.json.steps[0].state, "accepted(done)");

    fs.writeFileSync(path.join(t.root, "src/a/stray.ts"), "誰の変更か分からない\n");
    resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, ["src/a/stray.ts"]);

    t.run(["note", "--root", t.root, "--task", "T7", "--kind", "step", "--step", "2", "--changed", "src/a/stray.ts", "--text", "s2 で足した"]);
    assert.deepEqual(t.run(["resume", "--root", t.root, "--task", "T7"]).json.unexplained_dirty, []);
  } finally { t.cleanup(); }
});

test("不採用の run の変更は説明に使わない", () => {
  const t = setup();
  try {
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "violate" }); // 許可外だけ戻し、許可内の impl.ts は残る(不採用)
    const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, ["src/a/impl.ts"]);
  } finally { t.cleanup(); }
});

// 条件が真になるまで 50ms ごとに確かめる。timeoutMs を過ぎたら失敗させる
async function waitFor(condition, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: 条件が満たされないまま時間切れ");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

const wsArgs = (t) => [...baseArgs(t.root, t.packet), "--workspace", t.ws];

const worklogEntries = (t, kind) => fs.readFileSync(path.join(t.taskDir, "worklog.md"), "utf8")
  .split("\n")
  .filter((line) => line.includes(`kind=${kind} `));

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

test("events.jsonl は行を保持して受信時刻を付け、run は command metrics を集計する", () => {
  const t = setup();
  try {
    const runStartedAt = Date.now();
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "timing" });
    const runEndedAt = Date.now();
    assert.equal(code, 0, JSON.stringify(json));

    const expected = [
      "", "not-json",
      JSON.stringify({
        type: "item.started",
        item: {
          id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "other-1", type: "command_execution", command: "sed -n 1p README.md" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "other-1", type: "command_execution", command: "sed -n 1p README.md",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts",
          exit_code: 0,
        },
      }),
      JSON.stringify({ type: "message", text: "多バイト文字 é" }),
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution", command: "/bin/zsh -lc 'npm test'", exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          changes: [{ path: path.join(t.root, "src/a/impl.ts"), kind: "add" }],
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      }),
    ];
    const actual = fs.readFileSync(path.join(json.run_dir, "events.jsonl"), "utf8").split("\n");
    assert.equal(actual.length, expected.length + 2);
    assert.match(actual[0], /^\{"received_at":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",/);
    assert.ok(actual[0].includes('"type":"thread.started"'));
    for (const line of actual.filter((entry) => entry.startsWith('{"received_at":'))) {
      const receivedAt = Date.parse(JSON.parse(line).received_at);
      assert.ok(receivedAt >= runStartedAt && receivedAt <= runEndedAt, line);
    }
    for (const [index, line] of expected.entries()) {
      const actualLine = actual[index + 1];
      if (!line || line === "not-json") {
        assert.equal(actualLine, line);
      } else {
        assert.match(actualLine, /^\{"received_at":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",/);
        assert.equal(actualLine.slice(actualLine.indexOf(",") + 1), line.slice(1));
      }
    }

    const { metrics } = json;
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
      "check_by_tool", "other_by_tool",
    ])
      assert.ok(Object.hasOwn(metrics, key), key);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
    ])
      assert.ok(Number.isInteger(metrics[key]), key);
    assert.deepEqual(metrics.check_by_tool, { "npm test": 0, packet: 0, pytest: 0 });
    assert.deepEqual(metrics.other_by_tool, { sed: 0 });
    for (const seconds of [
      ...Object.values(metrics.check_by_tool), ...Object.values(metrics.other_by_tool),
    ])
      assert.ok(Number.isInteger(seconds));
    assert.equal(metrics.check_count, 3);
    assert.equal(metrics.other_command_count, 1);
    const measured = metrics.check_s + metrics.other_command_s + metrics.model_s;
    assert.ok(Math.abs(measured - metrics.duration_s) <= 1);
    assert.ok(Number.isInteger(metrics.runner_s) && metrics.runner_s >= metrics.duration_s);
  } finally { t.cleanup(); }
});

test("チャンク境界の多バイト文字と改行なしの末尾イベントを保つ", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "chunked" });
    const splitEvent = '{"type":"message","text":"é"}';
    const finalEvent = '{"type":"message","text":"末尾"}';
    const events = fs.readFileSync(path.join(json.run_dir, "events.jsonl"), "utf8");
    const actualLines = events.split("\n");

    assert.equal(actualLines.length, 3);
    assert.match(actualLines[1], /^\{"received_at":"\d{4}-\d\d-\d\dT/);
    assert.match(actualLines[2], /^\{"received_at":"\d{4}-\d\d-\d\dT/);
    assert.equal(actualLines[1].slice(actualLines[1].indexOf(",") + 1), splitEvent.slice(1));
    assert.equal(actualLines[2].slice(actualLines[2].indexOf(",") + 1), finalEvent.slice(1));
    assert.doesNotThrow(() => JSON.parse(actualLines[1]));
    assert.doesNotThrow(() => JSON.parse(actualLines[2]));
    assert.equal(events.endsWith(actualLines[2]), true);
  } finally { t.cleanup(); }
});

test("時間切れの run も metrics の全キーを出し model_s は 0 以上", () => {
  const t = setup();
  try {
    const { code, json } = t.run(
      [...baseArgs(t.root, t.packet), "--timeout", "1"],
      { FAKE_MODE: "timing-timeout" },
    );
    assert.equal(code, 1);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
      "check_by_tool", "other_by_tool",
    ])
      assert.ok(Object.hasOwn(json.metrics, key), key);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
    ])
      assert.ok(Number.isInteger(json.metrics[key]), key);
    assert.ok(json.metrics.check_by_tool && typeof json.metrics.check_by_tool === "object");
    assert.ok(json.metrics.other_by_tool && typeof json.metrics.other_by_tool === "object");
    assert.ok(json.metrics.model_s >= 0);
    assert.equal(json.metrics.check_count, 1);
    const measured = json.metrics.check_s + json.metrics.other_command_s + json.metrics.model_s;
    assert.ok(Math.abs(measured - json.metrics.duration_s) <= 1);
    assert.ok(Number.isInteger(json.metrics.runner_s));
    assert.ok(json.metrics.runner_s >= json.metrics.duration_s);
  } finally { t.cleanup(); }
});

test(
  "run --worktree は同じ本体の accepted run に branch が無ければ拒否する",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.mkdirSync(path.join(t.ws, "src/a"), { recursive: true });
      const legacy = t.run(wsArgs(t), { FAKE_MODE: "ok" });
      assert.equal(legacy.code, 0, JSON.stringify(legacy.json));
      assert.equal(legacy.json.accepted, true);

      const sandboxCallsBefore = t.sandboxCalls().length;
      const workerEnvBefore = t.execEnv();
      const attempted = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });

      assert.equal(attempted.code, 2);
      assert.match(attempted.json.errors.join("\n"), /branch なし accepted run がある/);
      assert.equal(
        t.sandboxCalls().length,
        sandboxCallsBefore,
        "拒否時は worker を起動しない",
      );
      assert.deepEqual(t.execEnv(), workerEnvBefore);
      assert.equal(fs.existsSync(path.join(t.taskDir, "worktree.json")), false);
    } finally { t.cleanup(); }
  },
);

test(
  "worktree.json がある本体リポジトリで --worktree 無しの run を拒否する",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const createArgs = [...baseArgs(t.root, t.packet)];
      createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
      createArgs.push("--workspace", t.ws, "--worktree");
      const created = t.run(createArgs, { FAKE_MODE: "ok" });
      assert.equal(created.code, 2);
      assert.match(created.json.errors.join("\n"), /T の対象の外/);
      assert.equal(
        t.execEnv(),
        null,
        "作業場所の検査拒否より前に worker を起動しない",
      );
      assert.ok(
        fs.existsSync(path.join(t.taskDir, "worktree.json")),
        "検査拒否後も作成した記録を残す",
      );

      const sandboxCallsBefore = t.sandboxCalls().length;
      const withoutWorktree = t.run(wsArgs(t), { FAKE_MODE: "ok" });

      assert.equal(withoutWorktree.code, 2);
      assert.match(
        withoutWorktree.json.errors.join("\n"),
        /worktree.json の本体リポジトリ/,
      );
      assert.equal(
        t.sandboxCalls().length,
        sandboxCallsBefore,
        "拒否時は worker を起動しない",
      );
      assert.equal(t.execEnv(), null);
    } finally { t.cleanup(); }
  },
);

test(
  "削除済み repo の記録では本体外から --worktree 無しで run できる",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const createArgs = [...baseArgs(t.root, t.packet)];
      createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
      createArgs.push("--workspace", t.ws, "--worktree");
      const created = t.run(createArgs, { FAKE_MODE: "ok" });
      assert.equal(created.code, 2);
      assert.ok(fs.existsSync(path.join(t.taskDir, "worktree.json")));

      const missingRepo = path.join(t.base, "deleted-repo");
      const recordPath = path.join(t.taskDir, "worktree.json");
      const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      fs.writeFileSync(recordPath, JSON.stringify({ ...record, repo: missingRepo }, null, 2));
      assert.equal(fs.existsSync(missingRepo), false);

      const result = t.run(wsArgs(t), { FAKE_MODE: "ok" });

      assert.equal(result.code, 0, JSON.stringify(result.json));
      assert.equal(result.json.accepted, true);
      assert.doesNotMatch(
        result.json.errors?.join("\n") ?? "",
        /worktree\.json の本体リポジトリ/,
      );
    } finally { t.cleanup(); }
  },
);

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
function createCleanRecordedWorktree(t) {
  fs.writeFileSync(path.join(t.wsRepo, "src/a/fixture.ts"), "fixture\n");
  git(t.wsRepo, "add", "src/a/fixture.ts");
  git(t.wsRepo, "commit", "-qm", "track workspace target");

  const createArgs = [...baseArgs(t.root, t.packet)];
  createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
  createArgs.push("--workspace", t.ws, "--worktree");
  const created = t.run(createArgs, { FAKE_MODE: "ok" });

  assert.equal(created.code, 2, JSON.stringify(created.json));
  assert.equal(t.execEnv(), null, "前提検査で worker を起動しない");
  const recordPath = path.join(t.taskDir, "worktree.json");
  const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
  const worktreePath = fs.realpathSync(record.path);
  assert.equal(git(worktreePath, "status", "--porcelain"), "");

  return { record, worktreePath };
}

/** Write a live worker lock under the fixture's TMPDIR.
 * @param {ReturnType<typeof setup>} t Test fixture.
 * @param {string} root Repository root protected by the lock.
 * @returns {void}
 */
function writeLiveWorkerLock(t, root) {
  const canonicalRoot = fs.realpathSync(root);
  const digest = createHash("sha1").update(canonicalRoot).digest("hex").slice(0, 16);
  const lockDir = path.join(t.tmp, "claude-task-scope");
  const lockPath = path.join(lockDir, `worker-lock-${digest}.json`);
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(lockPath, JSON.stringify({
    root: canonicalRoot,
    taskRoot: t.root,
    task: "T7",
    step: "1",
    pid: process.pid,
    expiresAt: Date.now() + 60_000,
  }));
}

/** Refuse integration and prove the main repository state was preserved.
 * @param {ReturnType<typeof setup>} t Test fixture.
 * @param {RegExp} expectedError Expected precondition message.
 * @returns {void}
 */
function assertIntegrationRefusalLeavesMainUnchanged(t, expectedError) {
  const before = {
    head: git(t.wsRepo, "rev-parse", "HEAD").trim(),
    status: git(t.wsRepo, "status", "--porcelain"),
  };

  const result = t.run(["integrate", "--root", t.root, "--task", "T7"]);

  assert.equal(result.code, 2, JSON.stringify(result.json));
  assert.deepEqual(Object.keys(result.json), ["errors"]);
  assert.match(result.json.errors.join("\n"), expectedError);
  assert.deepEqual({
    head: git(t.wsRepo, "rev-parse", "HEAD").trim(),
    status: git(t.wsRepo, "status", "--porcelain"),
  }, before);
}

/** Refuse integration with exit 1 and prove the canonical main repository state was preserved.
 * @param {ReturnType<typeof setup>} t Test fixture.
 * @param {string} expectedError Expected message fragment.
 * @returns {void}
 */
function assertIntegrationFailureLeavesMainUnchanged(t, expectedError) {
  const repo = fs.realpathSync(t.wsRepo);
  /** Read the canonical main repository's HEAD and porcelain status.
   * @returns {{ head: string, status: string }} Current main repository state.
   */
  const readMainState = () => ({
    head: git(repo, "rev-parse", "HEAD").trim(),
    status: git(repo, "status", "--porcelain"),
  });
  const before = readMainState();

  const result = t.run(["integrate", "--root", t.root, "--task", "T7"]);

  assert.equal(result.code, 1, JSON.stringify(result.json));
  assert.deepEqual(Object.keys(result.json), ["errors"]);
  assert.ok(result.json.errors.join("\n").includes(expectedError), JSON.stringify(result.json));
  assert.deepEqual(readMainState(), before);
}

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
