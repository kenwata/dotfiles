// codex-worker の cli の試験が共有する足場: 偽の codex、試験用のリポジトリと runner の起動、待ち合わせ、
// worktree の記録を作る関数。試験のファイルは主題ごとに分け(cli-*.test.mjs)、node --test がファイルを
// 別々のプロセスで並列に走らせる(1 ファイルに 91 件を置いた時は直列で約 85 秒かかり、検証の待ちの大半だった)。

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn, spawnSync } from "node:child_process";

// 検証節: 1 本目は worker の変更があれば通り、2 本目は必ず落ちる。束ねて打つと 1 本目の成否が分からなくなる組み合わせ
export const VERIFY_SECTION = "## 検証\n- `test -f src/a/impl.ts` (worker の変更がある)\n- `echo checked; exit 3`\n";

export const PLAN = "# T7 のステップ\n\n- s1: impl を書く\n- s2: 呼び出し元を直す\n";

export const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

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
// step-file: 並列ステップの試験用。FAKE_FILE だけを書き、src/a/impl.ts は書かない
if (mode === "step-file") {
  fs.mkdirSync(path.dirname(path.join(root, process.env.FAKE_FILE)), { recursive: true });
  fs.writeFileSync(path.join(root, process.env.FAKE_FILE), "written by a parallel step\\n");
  fs.writeFileSync(out, JSON.stringify({ status: "done", changed_files: [process.env.FAKE_FILE], tests_run: [], criteria: [], holes: [], reference_errors: [], notes: "" }));
  console.log(JSON.stringify({ type: "turn.completed", usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 } }));
  return;
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

export function git(root, ...args) {
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
export const todoWithTarget = (target) =>
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

// 試験を打つ環境の変数から、runner の挙動を変えるものを除いて子プロセスへ渡す。CODEX_THREAD_ID は note の書き手を
// codex:… にするので、Codex worker の中で試験を打つと by=claude を期待する試験が落ちていた(2026-09-25)。
// その値を試す試験は extraEnv で明示して渡す
function inheritedEnv() {
  return Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== "CODEX_THREAD_ID"));
}

// workspace: "repo" なら、帳簿(TODO.md)の root とは別のリポジトリ wsrepo を worker の
// 作業場所にする。
// "subdir" なら wsrepo の中の pkg を作業場所にする。どちらも T の対象を HOME からの ~ で書く
// (~/.claude が dotfiles を指す構成を写す)
export function setup({ workspace = null } = {}) {
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
    ...inheritedEnv(), PATH: `${bin}:${process.env.PATH}`, CODEX_WORKER_HOME: home, TMPDIR: tmp,
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

export const baseArgs = (root, packet) => ["run", "--root", root, "--task", "T7", "--step", "1", "--packet", packet, "--allow", "src/a/impl.ts"];

export const assertStatusLogLines = (log) => {
  const statusLine = /^\[Codex [^\]]*\] \d{2}:\d{2}:\d{2} /;
  assert.ok(log.trimEnd().split("\n").every((line) => statusLine.test(line)), log);
};

export const readLog = (t) => fs.readFileSync(path.join(t.taskDir, "worklog.md"), "utf8");

// 条件が真になるまで 50ms ごとに確かめる。timeoutMs を過ぎたら失敗させる
export async function waitFor(condition, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("waitFor: 条件が満たされないまま時間切れ");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

export const wsArgs = (t) => [...baseArgs(t.root, t.packet), "--workspace", t.ws];

export const worklogEntries = (t, kind) => fs.readFileSync(path.join(t.taskDir, "worklog.md"), "utf8")
  .split("\n")
  .filter((line) => line.includes(`kind=${kind} `));

export function createCleanRecordedWorktree(t) {
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
export function writeLiveWorkerLock(t, root) {
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
export function assertIntegrationRefusalLeavesMainUnchanged(t, expectedError) {
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
export function assertIntegrationFailureLeavesMainUnchanged(t, expectedError) {
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

// 並列ステップ(--worktree --parallel)の run の引数。作業場所は帳簿と別のリポジトリ(setup の workspace: "repo")
export const parallelArgs = (t, step, allow) => [
  "run", "--root", t.root, "--task", "T7", "--step", step, "--packet", t.packet,
  "--allow", allow, "--workspace", t.ws, "--worktree", "--parallel",
];

// rebase がコミットを作るので、integrate-step を打つ子プロセスに git の署名を渡す
export const GIT_IDENTITY = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
};

// 疑似 codex の step-file モードで、並列ステップの worker が書くファイルを 1 つ指定する
export const stepFile = (file) => ({ FAKE_MODE: "step-file", FAKE_FILE: file });
