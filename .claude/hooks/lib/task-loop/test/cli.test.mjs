// 連続実行ループ(cli.mjs run)の流れを、偽の herdr で確かめる(本物の herdr・Claude・Codex は起動しない)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// 偽の herdr: 状態を FAKE_HERDR_STATE の JSON に持つ。/clear・/new で session を変え(ignoreClear なら変えず、
// blockOnClear なら変えた後に blocked)、/execute-task T<n> には scenario[T<n>] の先頭の動きで応える:
//   complete: TODO.md を [x] にしてコミット / mark_only: [x] にするだけ / dirty: complete + untracked を残す /
//   budget: hook と同じく予算停止を記録 / compact: 予算停止に加えて compact を記録(閾値をすり抜けた形)/ hole: HANDOFF.md に /amend を書く /
//   blocked: 質問の画面で止まる / stalled: 送信後に動かない / newsession: /clear なしに session が変わる /
//   unknown: 状態を分類できない / working: 送信後の get で 2 回 working を返してから complete する(監督のターンが
//   worker の完了通知で再開する間を再現)/ nothing: 何もしない
const FAKE_HERDR = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const file = process.env.FAKE_HERDR_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const agent = () => ({ agent: s.host, agent_status: s.status, agent_session: { value: s.session }, cwd: s.root, pane_id: "w1:p1" });
const ok = (a) => { process.stdout.write(JSON.stringify({ id: "x", result: { agent: a } })); process.exit(0); };
const fail = (code) => { process.stdout.write(JSON.stringify({ error: { code, message: code }, id: "x" })); process.exit(1); };
const git = (...a) => execFileSync("git", ["-C", s.root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...a]);
const sessionFile = () => path.join(process.env.XDG_STATE_HOME, "claude-task-loop", "sessions", s.session + ".json");
const complete = (task) => {
  const todo = path.join(s.root, "TODO.md");
  fs.writeFileSync(todo, fs.readFileSync(todo, "utf8").replace(new RegExp("(\\\\| " + task + " \\\\|[^\\\\n]*)\\\\[ \\\\]"), "$1[x]"));
  git("commit", "-qam", "feat: " + task + " 完了");
};
if (args[0] === "--version") { console.log("herdr 0.9.1"); process.exit(0); }
if (args[0] !== "agent") fail("bad_args");
if (args[1] === "get" || args[1] === "wait") {
  if (s.workingLeft > 0) {
    s.workingLeft -= 1;
    if (s.workingLeft === 0) { s.status = "idle"; complete(s.pending); } else s.status = "working";
    save();
  }
  ok(agent());
}
if (args[1] === "read") { console.log("screen tail"); process.exit(0); }
if (args[1] === "prompt") {
  const text = args[3];
  if (s.status === "blocked") fail("agent_blocked");
  if (text === "/clear" || text === "/new") {
    if (!s.ignoreClear) { s.n += 1; s.session = "sess-" + s.n; }
    if (s.blockOnClear) s.status = "blocked";
    save();
    ok(agent());
  }
  const task = (text.match(/execute-task (T\\d+)/) || [])[1];
  const action = (s.scenario[task] || []).shift() || "nothing";
  save();
  if (action === "stalled") fail("agent_prompt_stalled");
  if (action === "complete" || action === "dirty") complete(task);
  if (action === "dirty") fs.writeFileSync(path.join(s.root, "stray.txt"), "x");
  if (action === "mark_only") {
    const todo = path.join(s.root, "TODO.md");
    fs.writeFileSync(todo, fs.readFileSync(todo, "utf8").replace(new RegExp("(\\\\| " + task + " \\\\|[^\\\\n]*)\\\\[ \\\\]"), "$1[x]"));
  }
  if (action === "budget" || action === "compact") {
    const cur = JSON.parse(fs.readFileSync(sessionFile(), "utf8"));
    cur.budget = { task, root: s.root, stage: 2, pct: 81 }; // compact の場面でも予算停止は立っている(閾値をすり抜けた形)
    if (action === "compact") cur.compact = { at: Date.now(), trigger: "auto" };
    fs.writeFileSync(sessionFile(), JSON.stringify(cur));
  }
  if (action === "hole") fs.writeFileSync(path.join(s.root, "HANDOFF.md"), "- 次の一手: /amend " + task + "\\n");
  if (action === "blocked") s.status = "blocked";
  if (action === "unknown") s.status = "unknown";
  if (action === "newsession") s.session = "sess-x-" + s.n;
  if (action === "working") { s.workingLeft = 2; s.pending = task; }
  save();
  ok(agent());
}
fail("bad_args");
`;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
}

function setup({ host = "claude", status = "idle", scenario = {}, todo, ignoreClear = false, blockOnClear = false } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "task-loop-cli-")));
  const root = path.join(base, "repo");
  fs.mkdirSync(root);
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "TODO.md"), todo ?? [
    "| #1-1 | T1 | 一つ目 | — | [ ] |", "| #1-2 | T2 | 二つ目 | — | [ ] |", "| #1-3 | T3 | 三つ目 | — | [ ] |", "",
    "**#1-1 / T1** — 完了条件: 対象: `src/`。", "**#1-2 / T2** — 完了条件: 対象: `src/`。依存: T1。", "**#1-3 / T3** — 完了条件: 対象: `src/`。依存: T9。", "",
  ].join("\n"));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  const bin = path.join(base, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "herdr"), FAKE_HERDR, { mode: 0o755 });
  const stateFile = path.join(base, "herdr.json");
  fs.writeFileSync(stateFile, JSON.stringify({ host, status, session: "sess-0", n: 0, root, scenario, ignoreClear, blockOnClear, workingLeft: 0 }));
  const logFile = path.join(base, "herdr.log");
  fs.writeFileSync(logFile, "");
  fs.mkdirSync(path.join(base, "tmp"));
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HERDR_ENV: "1", FAKE_HERDR_STATE: stateFile, FAKE_HERDR_LOG: logFile,
    XDG_STATE_HOME: path.join(base, "state"), XDG_CONFIG_HOME: path.join(base, "config"), TMPDIR: path.join(base, "tmp"),
  };
  const run = (...extra) => {
    const result = spawnSync("node", [cli, "run", "--target", "w1:p1", "--settle-sec", "0", ...extra], { env, encoding: "utf8", timeout: 60000 });
    return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };
  const prompts = () => fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((a) => a[1] === "prompt").map((a) => a[3]);
  const session = (id) => JSON.parse(fs.readFileSync(path.join(base, "state", "claude-task-loop", "sessions", `${id}.json`), "utf8"));
  const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { base, root, run, prompts, calls, session, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("T ごとに /clear してから /execute-task を送り、完了を成果物で確かめて次へ進む", () => {
  const t = setup({ scenario: { T1: ["complete"], T2: ["complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.reason, "all_done");
    assert.deepEqual(json.tasks_done, ["T1", "T2"]);
    assert.deepEqual(t.prompts(), ["/clear", "/execute-task T1", "/clear", "/execute-task T2"]);
    assert.deepEqual({ task: t.session("sess-2").loop.task, attempt: t.session("sess-2").loop.attempt }, { task: "T2", attempt: 1 });
    assert.ok(fs.existsSync(path.join(t.base, "state", "claude-task-loop", "last-run.json")));
  } finally { t.cleanup(); }
});

test("予算停止なら同じ T を新しいセッションで再送し、上限を超えたら止まる", () => {
  let t = setup({ scenario: { T1: ["budget", "complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), ["/clear", "/execute-task T1", "/clear", "/execute-task T1"]);
    assert.equal(t.session("sess-2").loop.attempt, 2);
    assert.equal(t.session("sess-2").budget, undefined, "新しいセッションの予算は空から始まる");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["budget", "budget"] } });
  try {
    const { code, json } = t.run("--tasks", "T1", "--retry-max", "1");
    assert.equal(code, 1);
    assert.equal(json.reason, "budget_retry_exhausted");
    assert.equal(json.attempt, 2);
    assert.deepEqual(json.tasks_remaining, ["T1"]);
  } finally { t.cleanup(); }
});

test("穴の記録・依存の未完了・質問の画面・送信後に動かない場合は止まり、再送しない", () => {
  let t = setup({ scenario: { T1: ["hole"] } });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 1);
    assert.equal(json.reason, "hole_recorded");
    assert.deepEqual(json.tasks_remaining, ["T1", "T2"]);
    assert.equal(json.tail.trim(), "screen tail");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["complete"] } });
  try {
    const { json } = t.run("--tasks", "T1,T3");
    assert.equal(json.reason, "dependency_open");
    assert.deepEqual(json.details.open, ["T9 が見つからない"]);
    assert.deepEqual(t.prompts(), ["/clear", "/execute-task T1"], "依存が締まっていない T には何も送らない");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["blocked"] } });
  try {
    assert.equal(t.run("--tasks", "T1").json.reason, "blocked");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["stalled"] } });
  try {
    const { json } = t.run("--tasks", "T1");
    assert.equal(json.reason, "stalled");
    assert.deepEqual(t.prompts(), ["/clear", "/execute-task T1"]);
  } finally { t.cleanup(); }
});

test("checkpoint 以後の完了が 5 件なら /follow-up が要るとして送らずに止まる", () => {
  const rows = Array.from({ length: 6 }, (_, i) => `| #1-${i + 1} | T${i + 1} | x | — | [${i < 5 ? "x" : " "}] |`);
  const t = setup({ todo: rows.join("\n") + "\n" });
  try {
    git(t.root, "commit", "-q", "--allow-empty", "-m", "chore: 総点検\n\nFollow-Up-Checkpoint: true");
    for (let i = 1; i <= 5; i += 1) git(t.root, "commit", "-q", "--allow-empty", "-m", `feat: T${i}`);
    const { json } = t.run("--tasks", "T6");
    assert.equal(json.reason, "follow_up_required");
    assert.equal(json.details.count, 5);
    assert.deepEqual(t.prompts(), []);
  } finally { t.cleanup(); }
});

test("Codex のペインには /new と $execute-task を送り、済んだ T は飛ばす", () => {
  const t = setup({ host: "codex", scenario: { T2: ["complete"] }, todo: "| #1-1 | T1 | x | — | [x] |\n| #1-2 | T2 | y | — | [ ] |\n" });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_skipped, ["T1"]);
    assert.deepEqual(t.prompts(), ["/new", "$execute-task T2"]);
  } finally { t.cleanup(); }
});

test("前提検査: 入力を受け付けない状態・説明できない未コミットの変更・herdr の外では exit 2、--dry-run は送る文だけ出す", () => {
  let t = setup({ status: "working" });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 2);
    assert.match(json.errors.join(), /入力を受け付ける状態ではない/);
  } finally { t.cleanup(); }

  t = setup();
  try {
    fs.writeFileSync(path.join(t.root, "stray.txt"), "x");
    let result = t.run("--tasks", "T1");
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /stray.txt/);
    fs.rmSync(path.join(t.root, "stray.txt"));
    result = t.run("--tasks", "T1..T2", "--dry-run");
    assert.equal(result.code, 0);
    assert.deepEqual(result.json.prompts, ["/execute-task T1", "/execute-task T2"]);
    assert.deepEqual(t.prompts(), []);
    const outside = spawnSync("node", [cli, "run", "--target", "w1:p1", "--tasks", "T1"], {
      env: { ...process.env, HERDR_ENV: "", XDG_STATE_HOME: path.join(t.base, "state") }, encoding: "utf8",
    });
    assert.equal(outside.status, 2);
    assert.match(JSON.parse(outside.stdout).errors.join(), /herdr の中で実行していない/);
  } finally { t.cleanup(); }
});

test("成果物が無い・コミットが無い・作業ツリーが汚れている時は止まり、理由を分ける", () => {
  for (const [action, reason] of [["nothing", "not_completed"], ["mark_only", "not_committed"], ["dirty", "dirty_after_commit"]]) {
    const t = setup({ scenario: { T1: [action] } });
    try {
      const { code, json } = t.run("--tasks", "T1..T2");
      assert.equal(code, 1, action);
      assert.equal(json.reason, reason, action);
      assert.deepEqual(json.tasks_remaining, ["T1", "T2"], action);
    } finally { t.cleanup(); }
  }
});

test("compact・session の変化・分類できない状態は止まる(予算停止より優先)", () => {
  for (const [action, reason] of [["compact", "compacted"], ["newsession", "session_changed"], ["unknown", "unknown"]]) {
    const t = setup({ scenario: { T1: [action] } });
    try {
      assert.equal(t.run("--tasks", "T1").json.reason, reason, action);
    } finally { t.cleanup(); }
  }
});

test("/clear で session が変わらない・/clear の後に blocked なら送らずに止まる", () => {
  let t = setup({ ignoreClear: true });
  try {
    const { json } = t.run("--tasks", "T1", "--clear-timeout-ms", "1200");
    assert.equal(json.reason, "clear_not_detected");
    assert.deepEqual(t.prompts(), ["/clear"]);
  } finally { t.cleanup(); }
  t = setup({ blockOnClear: true });
  try {
    assert.equal(t.run("--tasks", "T1").json.reason, "blocked_after_clear");
    assert.deepEqual(t.prompts(), ["/clear"]);
  } finally { t.cleanup(); }
});

test("廃止した T・無い T・関門の質問が残る T では止まる", () => {
  let t = setup({ todo: "| #1-1 | T1 | x(廃止: 不要) | — | [-] |\n" });
  try {
    assert.equal(t.run("--tasks", "T1").json.reason, "task_closed");
    assert.equal(t.run("--tasks", "T99").json.reason, "task_not_found");
    assert.deepEqual(t.prompts(), [], "どちらも送らない");
  } finally { t.cleanup(); }
  t = setup({ scenario: { T1: ["nothing"] } });
  try {
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "## 要確認\n- [回収: T1 着手前] どちらの案にするか\n");
    git(t.root, "add", "-A");
    git(t.root, "commit", "-qm", "handoff");
    assert.equal(t.run("--tasks", "T1").json.reason, "gate_question");
  } finally { t.cleanup(); }
});

test("送った後に working へ戻る間は待ってから判定し、worker のロックがある間も待つ", async () => {
  let t = setup({ scenario: { T1: ["working"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.ok(t.calls().filter((a) => a[1] === "wait").length >= 1, "working を見たら agent wait で待つ");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["nothing"] } });
  try {
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = path.join(t.base, "tmp");
    const { workerLockPath } = await import("../../../check-task-scope.mjs");
    const lock = workerLockPath(t.root);
    process.env.TMPDIR = saved;
    fs.mkdirSync(path.dirname(lock), { recursive: true });
    fs.writeFileSync(lock, JSON.stringify({ root: t.root, task: "T9", step: "1", pid: process.pid, expiresAt: Date.now() + 6000 }));
    const started = Date.now();
    const { json } = t.run("--tasks", "T1");
    assert.equal(json.reason, "not_completed");
    assert.ok(Date.now() - started >= 4000, "ロックが失効するまで待った");
    assert.equal(fs.existsSync(lock), false, "失効したロックは掃除される");
  } finally { t.cleanup(); }
});

test("タスクの制限時間を過ぎたら timeout で止まる", () => {
  const t = setup({ scenario: { T1: ["nothing"] } });
  try {
    const { json } = t.run("--tasks", "T1", "--task-timeout-min", "0.05", "--settle-sec", "30");
    assert.equal(json.reason, "timeout");
  } finally { t.cleanup(); }
});
