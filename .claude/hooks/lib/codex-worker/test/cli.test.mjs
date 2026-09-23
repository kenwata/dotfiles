// runner(cli.mjs)の run / restore の流れを、偽の codex で確かめる(本物の codex は起動しない)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// 偽の codex: `debug models` は一覧を返す。`exec` は FAKE_MODE に従って作業ツリーを変え、結果と rollout を書く
const FAKE_CODEX = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
if (args[0] === "debug" && args[1] === "models") {
  process.stdout.write(JSON.stringify({ models: [{ slug: "gpt-5.6-luna" }, { slug: "gpt-6-luna" }, { slug: "gpt-6-sol" }] }));
  process.exit(0);
}
const root = args[args.indexOf("-C") + 1];
const out = args[args.indexOf("-o") + 1];
const mode = process.env.FAKE_MODE;
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
console.log(JSON.stringify({ type: "item.started", item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'" } }));
console.log(JSON.stringify({ type: "item.completed", item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'", exit_code: 0 } }));
fs.writeFileSync(path.join(root, "src/a/impl.ts"), "impl\\n");
console.log(JSON.stringify({ type: "item.completed", item: { type: "file_change", changes: [{ path: path.join(root, "src/a/impl.ts"), kind: "add" }] } }));
if (mode === "violate") fs.writeFileSync(path.join(root, "other/y.ts"), "changed by worker\\n");
fs.writeFileSync(out, JSON.stringify({ status: "done", changed_files: ["src/a/impl.ts"], tests_run: [], criteria: [], holes: [], reference_errors: [], notes: "" }));
console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }));
`;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
}

function setup() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-cli-")));
  const root = path.join(base, "repo");
  fs.mkdirSync(path.join(root, "src/a"), { recursive: true });
  fs.mkdirSync(path.join(root, "other"), { recursive: true });
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "other/y.ts"), "y1\n");
  fs.writeFileSync(path.join(root, "TODO.md"), "| #1-1 | T7 | x | 中 | — | [ ] |\n\n**#1-1 / T7** — 完了条件: 対象: `src/a/`。\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");

  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "codex"), FAKE_CODEX, { mode: 0o755 });
  const home = path.join(base, "worker-home");
  fs.mkdirSync(home);
  fs.writeFileSync(path.join(home, "config.toml"), "");
  fs.writeFileSync(path.join(base, "auth.json"), "{}");
  fs.symlinkSync(path.join(base, "auth.json"), path.join(home, "auth.json"));
  const packet = path.join(base, "packet.md");
  fs.writeFileSync(packet, "## 目的\nimpl を書く\n\n## 横断の確認\n該当なし: 許可パス内で閉じる試験用の変更\n");
  const tmp = path.join(base, "tmp");
  fs.mkdirSync(tmp);
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, CODEX_WORKER_HOME: home, TMPDIR: tmp,
    XDG_STATE_HOME: path.join(base, "state"),
  };
  const run = (args, extraEnv = {}) => {
    const result = spawnSync("node", [cli, ...args], { env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 60000 });
    return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };
  const lockDir = path.join(tmp, "claude-task-scope");
  const locks = () => (fs.existsSync(lockDir) ? fs.readdirSync(lockDir).filter((n) => n.startsWith("worker-lock-")) : []);
  const statusLog = path.join(base, "state", "claude-codex-worker", "status", `${root.replace(/[^A-Za-z0-9]/g, "-")}.log`);
  return { base, root, packet, run, locks, statusLog, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

const baseArgs = (root, packet) => ["run", "--root", root, "--task", "T7", "--step", "1", "--packet", packet, "--allow", "src/a/impl.ts"];

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
      "[Codex T7 s1] $ npm test", "[Codex T7 s1]   ✓ npm test", "[Codex T7 s1] edit: src/a/impl.ts (add)",
      "[Codex T7 s1] tokens: input=10 cached=0 output=5", "[Codex T7 s1] finished: accepted worker=done changed=1",
    ];
    for (const out of [stderr, fs.readFileSync(t.statusLog, "utf8")]) {
      for (const line of expected) assert.ok(out.includes(line), `${line} が無い:\n${out}`);
      assert.match(out, /^\[Codex T7 s1\] started model=gpt-6-luna /m);
    }
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
    fs.writeFileSync(t.packet, "## 目的\nimpl を書く\n\n## 横断の確認\n該当なし: 試験用\n");
    result = t.run([...baseArgs(t.root, t.packet), "--model-family", "nova"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /系統 nova/);
    fs.writeFileSync(t.packet, "## 目的\nimpl を書く\n");
    result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /## 横断の確認/);
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
