// 連続実行ループ(cli.mjs run)の流れを、偽の herdr で確かめる(本物の herdr・Claude・Codex は起動しない)
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

// 偽の herdr: 状態を FAKE_HERDR_STATE の JSON に持つ。Claude は /clear で session を変える(ignoreClear なら変えず、
// blockOnClear なら変えた後に blocked)。Codex は本物と同じく /clear では変えず、次の発言で新しい session になる
// (ignoreClear なら前の session のまま)。/execute-task T<n> には scenario[T<n>] の先頭の動きで応える:
//   complete: TODO.md を [x] にしてコミット / mark_only: [x] にするだけ / dirty: complete + untracked を残す /
//   budget: hook と同じく予算停止を記録 / compact: 予算停止に加えて compact を記録(閾値をすり抜けた形)/ hole: HANDOFF.md の次の一手を /amend T<n> にする /
//   hole_elaborate: HANDOFF.md の次の一手を /elaborate にする / stalled: 送信後に動かない / newsession: /clear なしに session が変わる /
//   unknown: 状態を分類できない / working: 送信後の get で 2 回 working を返してから complete する(監督のターンが
//   worker の完了通知で再開する間を再現)/ question: 問いの画面(blocked)で止まり、人が答えると complete する /
//   stage_end: complete に加えて HANDOFF.md の次の一手を /breakdown docs/design/plan.md にする / nothing: 何もしない
// 問いの画面(blocked)で agent wait --until を受けたら、人が答えた形にする(s.onAnswer の動きをしてから idle)。
// /amend T<n> には scenario.amend の先頭で応える: land(穴の記録を消し、次の一手を /execute-task T<n> に戻して amend:
// でコミット)/ land_add(land に加えて T4 を足す)/ land_fix(是正タスク T4 を足し、次の一手を T4 にする)/ abolish(T<n> を廃止して置き換え先 T4 を立てる)/ question(承認の
// 問いで止まり、答えると land)/ elaborate(次の一手を /elaborate にするだけ)/ nothing
// /breakdown <設計書> には scenario.breakdown の先頭で応える: land(T4・T5 を足し、次の一手を /execute-task T4 に
// して plan: でコミット)/ nothing
// 端末の題名(pane get の terminal_title_stripped)は起動時の --name と /rename で変わり、/clear では変わらない
// (本物の Claude と同じく前の名前を引き継ぐ)。ignoreRename なら /rename を受けても変えない
const FAKE_HERDR = `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const file = process.env.FAKE_HERDR_STATE;
const s = JSON.parse(fs.readFileSync(file, "utf8"));
const args = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_HERDR_LOG, JSON.stringify(args) + "\\n");
const save = () => fs.writeFileSync(file, JSON.stringify(s));
const agent = (pane = "w1:p1") => ({ agent: s.host, agent_status: s.status, agent_session: { value: s.session }, cwd: s.root, foreground_cwd: s.root, pane_id: pane, tab_id: "t1" });
const ok = (a) => { process.stdout.write(JSON.stringify({ id: "x", result: { agent: a } })); process.exit(0); };
const fail = (code) => { process.stdout.write(JSON.stringify({ error: { code, message: code }, id: "x" })); process.exit(1); };
const git = (...a) => execFileSync("git", ["-C", s.root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...a]);
const sessionFile = () => path.join(process.env.XDG_STATE_HOME, "claude-task-loop", "sessions", s.session + ".json");
const complete = (task) => {
  const todo = path.join(s.root, "TODO.md");
  fs.writeFileSync(todo, fs.readFileSync(todo, "utf8").replace(new RegExp("(\\\\| " + task + " \\\\|[^\\\\n]*)\\\\[ \\\\]"), "$1[x]"));
  git("add", "-A");
  git("commit", "-qm", "feat: " + task + " 完了");
};
const handoff = (step) => fs.writeFileSync(path.join(s.root, "HANDOFF.md"), "## 仕掛かり中\\n\\n- なし\\n\\n## 次セッションの最初の一手\\n\\n- \`" + step + "\`(説明)\\n");
// 表の末尾(最初の空行の前)に行を、末尾に完了条件ブロックを足す
const addTasks = (ids) => {
  const todo = path.join(s.root, "TODO.md");
  const rows = ids.map((t) => "| #1-" + t.slice(1) + " | " + t + " | 追加 | — | [ ] |").join("\\n");
  const blocks = ids.map((t) => "**#1-" + t.slice(1) + " / " + t + "** — 完了条件: 対象: \`src/\`。").join("\\n");
  fs.writeFileSync(todo, fs.readFileSync(todo, "utf8").replace("\\n\\n", "\\n" + rows + "\\n\\n") + blocks + "\\n");
};
const amend = (how, task) => {
  if (how === "abolish") {
    const todo = path.join(s.root, "TODO.md");
    const lines = fs.readFileSync(todo, "utf8").split("\\n")
      .map((l) => l.startsWith("|") && l.includes("| " + task + " |") ? "| #1-1 | " + task + " | 廃止(廃止: 分け直し。→T4) | — | [-] |" : l);
    fs.writeFileSync(todo, lines.join("\\n"));
    addTasks(["T4"]);
    handoff("/execute-task T4");
  } else {
    if (how === "land_add" || how === "land_fix") addTasks(["T4"]);
    handoff("/execute-task " + (how === "land_fix" ? "T4" : task));
  }
  git("add", "-A");
  git("commit", "-qm", "amend: repo の設計を改訂(" + task + " 由来)");
};
const answer = () => {
  const [kind, arg] = s.onAnswer;
  s.onAnswer = null; s.status = "idle";
  if (kind === "complete") complete(arg);
  if (kind === "checkpoint") git("commit", "-q", "--allow-empty", "-m", "chore: follow-up checkpoint\\n\\nFollow-Up-Checkpoint: true");
  if (kind === "amend") amend("land", arg);
};
if (args[0] === "--version") { console.log("herdr 0.9.1"); process.exit(0); }
if (args[0] === "pane" && args[1] === "split") {
  s.splits = (s.splits || 0) + 1; save();
  process.stdout.write(JSON.stringify({ id: "x", result: { pane: { pane_id: "w1:p" + (1 + s.splits), cwd: args[args.indexOf("--cwd") + 1] } } })); process.exit(0);
}
if (args[0] === "pane" && args[1] === "get") {
  process.stdout.write(JSON.stringify({ id: "x", result: { pane: { pane_id: args[2], terminal_title_stripped: s.title ?? null } } })); process.exit(0);
}
if (args[0] !== "agent") fail("bad_args");
if (args[1] === "list") {
  const agents = s.agents === "none" ? [] : s.agents === "many" ? [agent("w1:p1"), agent("w1:p9")] : s.agents === "busy" ? [{ ...agent(), agent_status: "working" }] : [agent()];
  process.stdout.write(JSON.stringify({ id: "x", result: { agents } })); process.exit(0);
}
if (args[1] === "start") {
  s.started = { name: args[2], kind: args[args.indexOf("--kind") + 1], pane: args[args.indexOf("--pane") + 1], extra: args.includes("--") ? args.slice(args.indexOf("--") + 1) : [] };
  if (s.started.extra.includes("--name")) s.title = s.started.extra[s.started.extra.indexOf("--name") + 1];
  s.status = "idle"; save();
  ok(agent(s.started.pane));
}
if (args[1] === "wait" && s.status === "blocked" && args.includes("--until")) {
  if (!s.onAnswer) fail("timeout");
  s.waitedBlocked = (s.waitedBlocked || 0) + 1;
  if (s.answerDelayMs) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, s.answerDelayMs); // 人が答えるまでの間
  answer(); save();
  ok(agent());
}
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
  if (text === "/clear") {
    if (s.host === "codex") s.fresh = !s.ignoreClear;
    else if (!s.ignoreClear) { s.n += 1; s.session = "sess-" + s.n; }
    if (s.blockOnClear) s.status = "blocked";
    save();
    ok(agent());
  }
  if (text === "/new") fail("bad_args"); // Codex の /new は worktrees 機能が有効だと選択画面で止まるので使わない
  if (s.fresh) { s.fresh = false; s.n += 1; s.session = "sess-" + s.n; save(); }
  if (text.startsWith("/rename ")) {
    if (!s.ignoreRename) s.title = text.slice("/rename ".length);
    save();
    ok(agent());
  }
  if (/follow-up$/.test(text)) {
    const fu = (s.scenario["follow-up"] || []).shift() || "nothing";
    if (fu === "checkpoint") git("commit", "-q", "--allow-empty", "-m", "chore: follow-up checkpoint\\n\\nFollow-Up-Checkpoint: true");
    if (fu === "question") { s.status = "blocked"; s.onAnswer = ["checkpoint"]; }
    save();
    ok(agent());
  }
  const amendTask = (text.match(/amend (T\\d+)$/) || [])[1];
  if (amendTask) {
    const how = (s.scenario.amend || []).shift() || "nothing";
    s.amendSent = (s.amendSent || 0) + 1;
    if (how === "question") { s.status = "blocked"; s.onAnswer = ["amend", amendTask]; }
    else if (how === "elaborate") handoff("/elaborate docs/design/plan.md");
    else if (how !== "nothing") amend(how, amendTask);
    save();
    ok(agent());
  }
  if (/breakdown docs\\/design\\//.test(text)) {
    const how = (s.scenario.breakdown || []).shift() || "nothing";
    if (how === "land") {
      addTasks(["T4", "T5"]);
      handoff("/execute-task T4");
      git("add", "-A");
      git("commit", "-qm", "plan: plan の実行計画を策定(T4〜T5)");
    }
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
    // 本物の hook(updateSession)と同じく、ループがまだ書いていなければ作る(Codex はループが送った後に書く)
    const cur = fs.existsSync(sessionFile()) ? JSON.parse(fs.readFileSync(sessionFile(), "utf8")) : {};
    fs.mkdirSync(path.dirname(sessionFile()), { recursive: true });
    cur.budget = { task, root: s.root, stage: 2, pct: 81 }; // compact の場面でも予算停止は立っている(閾値をすり抜けた形)
    if (action === "compact") cur.compact = { at: Date.now(), trigger: "auto" };
    fs.writeFileSync(sessionFile(), JSON.stringify(cur));
  }
  if (action === "hole") handoff("/amend " + task);
  if (action === "hole_elaborate") handoff("/elaborate docs/design/plan.md");
  if (action === "question") { s.status = "blocked"; s.onAnswer = ["complete", task]; }
  if (action === "stage_end") { handoff("/breakdown docs/design/plan.md"); complete(task); }
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

function setup({ host = "claude", status = "idle", scenario = {}, todo, ignoreClear = false, blockOnClear = false, ignoreRename = false, agents = "one", answerDelayMs = 0 } = {}) {
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
  fs.writeFileSync(stateFile, JSON.stringify({ host, status, session: "sess-0", n: 0, root, scenario, ignoreClear, blockOnClear, ignoreRename, workingLeft: 0, agents, answerDelayMs }));
  const logFile = path.join(base, "herdr.log");
  fs.writeFileSync(logFile, "");
  fs.mkdirSync(path.join(base, "tmp"));
  const env = {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, HERDR_ENV: "1", FAKE_HERDR_STATE: stateFile, FAKE_HERDR_LOG: logFile,
    XDG_STATE_HOME: path.join(base, "state"), XDG_CONFIG_HOME: path.join(base, "config"), TMPDIR: path.join(base, "tmp"), HERDR_TAB_ID: "t1",
  };
  const run = (...extra) => {
    const result = spawnSync("node", [cli, "run", "--target", "w1:p1", "--settle-sec", "0", ...extra], { env, encoding: "utf8", timeout: 60000 });
    return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };
  // --target を省略し、プロジェクトのディレクトリから打つ形(zsh の alias task-loop と同じ)
  const runAuto = (...extra) => {
    const result = spawnSync("node", [cli, "run", "--settle-sec", "0", ...extra], { env, cwd: root, encoding: "utf8", timeout: 60000 });
    return { code: result.status, json: JSON.parse(result.stdout), stderr: result.stderr };
  };
  const state = () => JSON.parse(fs.readFileSync(stateFile, "utf8"));
  const prompts = () => fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l))
    .filter((a) => a[1] === "prompt").map((a) => a[3]);
  const session = (id) => JSON.parse(fs.readFileSync(path.join(base, "state", "claude-task-loop", "sessions", `${id}.json`), "utf8"));
  const calls = () => fs.readFileSync(logFile, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  return { base, root, run, runAuto, state, prompts, calls, session, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("T ごとに /clear してから /execute-task を送り、完了を成果物で確かめて次へ進む", () => {
  const t = setup({ scenario: { T1: ["complete"], T2: ["complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.reason, "all_done");
    assert.deepEqual(json.tasks_done, ["T1", "T2"]);
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1", "/clear", "/rename repo T2", "/execute-task T2"]);
    assert.deepEqual({ task: t.session("sess-2").loop.task, attempt: t.session("sess-2").loop.attempt }, { task: "T2", attempt: 1 });
    assert.ok(fs.existsSync(path.join(t.base, "state", "claude-task-loop", "last-run.json")));
  } finally { t.cleanup(); }
});

test("予算停止なら同じ T を新しいセッションで再送し、上限を超えたら止まる", () => {
  let t = setup({ scenario: { T1: ["budget", "complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1", "/clear", "/execute-task T1"], "再送のセッションは同じ名前を引き継ぐので付け直さない");
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

test("次の一手が /elaborate・依存の未完了・送信後に動かない場合は止まり、再送しない", () => {
  let t = setup({ scenario: { T1: ["hole_elaborate"] } });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 1);
    assert.equal(json.reason, "hole_recorded");
    assert.deepEqual(json.tasks_remaining, ["T1", "T2"]);
    assert.deepEqual(json.next_step, { command: "elaborate", arg: "docs/design/plan.md" }, "人が次に打つ一手を JSON に出す");
    assert.equal(json.tail.trim(), "screen tail");
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1"], "/elaborate はループから送らない");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["complete"] } });
  try {
    const { json } = t.run("--tasks", "T1,T3");
    assert.equal(json.reason, "dependency_open");
    assert.deepEqual(json.details.open, ["T9 が見つからない"]);
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1"], "依存が締まっていない T には何も送らない");
  } finally { t.cleanup(); }

  t = setup({ scenario: { T1: ["stalled"] } });
  try {
    const { json } = t.run("--tasks", "T1");
    assert.equal(json.reason, "stalled");
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1"]);
  } finally { t.cleanup(); }
});

test("checkpoint 以後の完了が 5 件で --no-follow-up なら、/follow-up が要るとして送らずに止まる", () => {
  const rows = Array.from({ length: 6 }, (_, i) => `| #1-${i + 1} | T${i + 1} | x | — | [${i < 5 ? "x" : " "}] |`);
  const t = setup({ todo: rows.join("\n") + "\n" });
  try {
    git(t.root, "commit", "-q", "--allow-empty", "-m", "chore: 総点検\n\nFollow-Up-Checkpoint: true");
    for (let i = 1; i <= 5; i += 1) git(t.root, "commit", "-q", "--allow-empty", "-m", `feat: T${i}`);
    const { json } = t.run("--tasks", "T6", "--no-follow-up");
    assert.equal(json.reason, "follow_up_required");
    assert.equal(json.details.count, 5);
    assert.deepEqual(t.prompts(), []);
  } finally { t.cleanup(); }
});

test("Codex のペインには /clear と $execute-task を送り、送った後に変わった session に状態を書く。済んだ T は飛ばす", () => {
  let t = setup({ host: "codex", scenario: { T2: ["complete"] }, todo: "| #1-1 | T1 | x | — | [x] |\n| #1-2 | T2 | y | — | [ ] |\n" });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_skipped, ["T1"]);
    assert.deepEqual(t.prompts(), ["/clear", "$execute-task T2"]);
    assert.deepEqual({ task: t.session("sess-1").loop.task, host: t.session("sess-1").host }, { task: "T2", host: "codex" });
  } finally { t.cleanup(); }

  t = setup({ host: "codex", scenario: { T1: ["budget", "complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), ["/clear", "$execute-task T1", "/clear", "$execute-task T1"], "予算停止は新しい session の budget で読む");
    assert.equal(t.session("sess-2").loop.attempt, 2);
  } finally { t.cleanup(); }

  t = setup({ host: "codex", ignoreClear: true, scenario: { T1: ["complete"] } });
  try {
    const { code, json } = t.run("--tasks", "T1", "--clear-timeout-ms", "1200");
    assert.equal(code, 1);
    assert.equal(json.reason, "new_session_not_detected", "前の会話に届いた T は完了しても次へ進まない");
    assert.deepEqual(t.prompts(), ["/clear", "$execute-task T1"]);
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

test("--target を省略すると同じプロジェクトで入力待ちのペインを選び、--tasks を省略すると TODO.md の未着手の T を順に回す", () => {
  const t = setup({ scenario: { T1: ["complete"], T2: ["complete"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 1, JSON.stringify(json));
    assert.equal(json.target, "w1:p1");
    assert.deepEqual(json.tasks_done, ["T1", "T2"]);
    assert.equal(json.reason, "dependency_open", "T3 は依存が締まらず止まる");
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1", "/clear", "/rename repo T2", "/execute-task T2"]);
    const dry = t.runAuto("T2..T3", "--dry-run");
    assert.deepEqual([dry.json.tasks, dry.json.tasks_from], [["T2", "T3"], "args"], "位置引数の T も受け付ける");
  } finally { t.cleanup(); }
});

test("同じプロジェクトにペインが無ければ隣に作って起動し、複数あれば選ばずに止まる", () => {
  let t = setup({ agents: "none", scenario: { T1: ["complete"] } });
  try {
    const { code, json } = t.runAuto("T1", "--model", "claude-opus-5-5");
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.target, "w1:p2");
    const started = t.state().started;
    assert.equal(started.kind, "claude");
    assert.equal(started.pane, "w1:p2");
    assert.deepEqual(started.extra, ["--name", "repo loop", "--model", "claude-opus-5-5"]);
  } finally { t.cleanup(); }
  t = setup({ agents: "none" });
  try {
    const { code, json } = t.runAuto("T1", "--dry-run");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.would_start, { kind: "claude", args: ["--name", "repo loop"] });
    assert.equal(json.target, null);
    assert.deepEqual(json.prompts, ["/execute-task T1"]);
    assert.equal(t.state().splits, undefined, "--dry-run はペインを作らない");
    assert.equal(t.state().started, undefined);
  } finally { t.cleanup(); }
  t = setup({ agents: "many" });
  try {
    const { code, json } = t.runAuto("T1");
    assert.equal(code, 2);
    assert.match(json.errors.join(), /複数ある.*w1:p1.*w1:p9/);
  } finally { t.cleanup(); }
  t = setup({ agents: "busy" });
  try {
    assert.match(t.runAuto("T1").json.errors.join(), /入力待ちではない/);
  } finally { t.cleanup(); }
  t = setup({ todo: "| #1-1 | T1 | 済み | — | [x] |\n" });
  try {
    assert.match(t.runAuto().json.errors.join(), /未着手.*が無く、次の一手も \/breakdown ではない/);
  } finally { t.cleanup(); }
});

// checkpoint 以後に 5 件完了した状態(T1〜T5 が [x]、T6 が [ ])を作る
function fiveDone(scenario, todoExtra = "") {
  const rows = Array.from({ length: 6 }, (_, i) => `| #1-${i + 1} | T${i + 1} | x | — | [${i < 5 ? "x" : " "}] |`);
  const t = setup({ scenario, todo: rows.join("\n") + "\n" + todoExtra });
  git(t.root, "commit", "-q", "--allow-empty", "-m", "chore: 総点検\n\nFollow-Up-Checkpoint: true");
  for (let i = 1; i <= 5; i += 1) git(t.root, "commit", "-q", "--allow-empty", "-m", `feat: T${i}`);
  return t;
}

test("完了が 5 件に達したら /follow-up を送り、checkpoint が増えたら次の T へ進む", () => {
  let t = fiveDone({ "follow-up": ["checkpoint"], T6: ["complete"] });
  try {
    const { code, json } = t.runAuto("T6");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo follow-up", "/follow-up", "/clear", "/rename repo T6", "/execute-task T6"]);
    assert.equal(t.session("sess-1").loop.task, "follow-up");
  } finally { t.cleanup(); }

  t = fiveDone({ T6: ["complete"] });
  try {
    const { json } = t.runAuto("T6", "--no-follow-up");
    assert.equal(json.reason, "follow_up_required");
    assert.deepEqual(t.prompts(), [], "--no-follow-up なら何も送らずに止まる");
  } finally { t.cleanup(); }
});

test("/follow-up が利用者への問いを出せば答えを待って続け、checkpoint が増えなければ止まる", () => {
  let t = fiveDone({ "follow-up": ["question"], T6: ["complete"] });
  try {
    const { code, json } = t.runAuto("T6");
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(t.state().waitedBlocked, 1, "問いの画面では答えを待った");
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo follow-up", "/follow-up", "/clear", "/rename repo T6", "/execute-task T6"]);
  } finally { t.cleanup(); }
  t = fiveDone({ "follow-up": ["nothing"] });
  try {
    const { json } = t.runAuto("T6");
    assert.equal(json.reason, "follow_up_incomplete");
  } finally { t.cleanup(); }
});

test("セッション名は T の計画の slug と T(/follow-up の前は follow-up、自動起動は loop)で、/clear の後に毎回付け直す", () => {
  const todo = [
    "## #2 alpha-plan", "| #2-1 | T1 | 一つ目 | — | [ ] |", "| #2-2 | T2 | 二つ目 | — | [ ] |", "",
    "**#2-1 / T1** — 完了条件: 対象: `src/`。", "**#2-2 / T2** — 完了条件: 対象: `src/`。依存: T1。", "",
  ].join("\n");
  const t = setup({ agents: "none", todo, scenario: { T1: ["complete"], T2: ["complete"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.state().started.extra, ["--name", "alpha-plan loop"], "起動時の名前は最初の T の計画");
    assert.deepEqual(t.prompts(), ["/clear", "/rename alpha-plan T1", "/execute-task T1", "/clear", "/rename alpha-plan T2", "/execute-task T2"]);
    assert.equal(t.state().title, "alpha-plan T2", "窓の題名は最後に送った T");
  } finally { t.cleanup(); }
});

test("Codex のペインを起動する時は名前を付けず、前提検査で止まる時はペインを起動しない", () => {
  let t = setup({ host: "codex", agents: "none", scenario: { T1: ["complete"] } });
  try {
    const { code, json } = t.runAuto("T1", "--kind", "codex");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.state().started.extra, []);
    assert.deepEqual(t.prompts(), ["/clear", "$execute-task T1"]);
  } finally { t.cleanup(); }
  t = setup({ agents: "none" });
  try {
    fs.writeFileSync(path.join(t.root, "stray.txt"), "x");
    const { code, json } = t.runAuto("T1");
    assert.equal(code, 2);
    assert.match(json.errors.join(), /stray.txt/);
    assert.equal(t.state().splits, undefined, "ペインを作っていない");
  } finally { t.cleanup(); }
});

test("名前が題名に反映されなくても止めずに次へ進み、stderr に書く", () => {
  const t = setup({ ignoreRename: true, scenario: { T1: ["complete"] } });
  try {
    const { code, json, stderr } = t.run("--tasks", "T1", "--clear-timeout-ms", "1200");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), ["/clear", "/rename repo T1", "/execute-task T1"]);
    assert.match(stderr, /\[loop T1\] rename: .*"repo T1"/);
  } finally { t.cleanup(); }
});

test("問いの画面(blocked)では止めずに答えを待ち、待った時間は制限時間に数えない", () => {
  let t = setup({ scenario: { T1: ["question"] } });
  try {
    const { code, json, stderr } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(t.state().waitedBlocked, 1);
    assert.match(stderr, /\[loop T1\] blocked: 利用者の答えを待つ/);
  } finally { t.cleanup(); }
  t = setup({ scenario: { T1: ["question"] }, answerDelayMs: 4000 });
  try {
    const { code, json } = t.run("--tasks", "T1", "--task-timeout-min", "0.05");
    assert.equal(code, 0, `制限時間 3 秒に対して答えまで 4 秒かかっても timeout にしない: ${JSON.stringify(json)}`);
  } finally { t.cleanup(); }
});

// T1・T2(依存なし)の TODO.md
const TWO = ["| #1-1 | T1 | 一つ目 | — | [ ] |", "| #1-2 | T2 | 二つ目 | — | [ ] |", "", "**#1-1 / T1** — 完了条件: 対象: `src/`。", "**#1-2 / T2** — 完了条件: 対象: `src/`。", ""].join("\n");

test("穴の記録で止まったら /amend T を送り、着地したら同じ T を attempt 1 から送り直す", () => {
  let t = setup({ scenario: { T1: ["hole", "complete"], amend: ["land"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(t.prompts(), [
      "/clear", "/rename repo T1", "/execute-task T1", "/clear", "/rename repo T1 amend", "/amend T1", "/clear", "/rename repo T1", "/execute-task T1",
    ]);
    assert.deepEqual({ task: t.session("sess-2").loop.task, attempt: t.session("sess-3").loop.attempt }, { task: "T1", attempt: 1 });
  } finally { t.cleanup(); }
  t = setup({ scenario: { T1: ["hole", "complete"], amend: ["question"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, `amend の承認の問いは答えを待つ: ${JSON.stringify(json)}`);
    assert.equal(t.state().waitedBlocked, 1);
  } finally { t.cleanup(); }
});

test("amend が着地しない・/elaborate へ回した・同じ T で 2 回目の穴なら止まる", () => {
  for (const [scenario, reason] of [
    [{ T1: ["hole"], amend: ["nothing"] }, "amend_incomplete"],
    [{ T1: ["hole"], amend: ["elaborate"] }, "amend_to_elaborate"],
    [{ T1: ["hole", "hole"], amend: ["land", "land"] }, "amend_repeated"],
  ]) {
    const t = setup({ scenario });
    try {
      const { code, json } = t.run("--tasks", "T1..T2");
      assert.equal(code, 1, reason);
      assert.equal(json.reason, reason);
      assert.deepEqual(json.tasks_remaining, ["T1", "T2"], reason);
      assert.equal(t.state().amendSent, 1, `amend は 1 回だけ送る: ${reason}`);
    } finally { t.cleanup(); }
  }
});

test("amend が足した T は TODO.md から回す時だけ拾い、廃止した T は置き換え先から続ける", () => {
  let t = setup({ todo: TWO, scenario: { T1: ["hole", "complete"], T2: ["complete"], T4: ["complete"], amend: ["land_add"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T1", "T2", "T4"]);
  } finally { t.cleanup(); }
  t = setup({ todo: TWO, scenario: { T1: ["hole", "complete"], T2: ["complete"], amend: ["land_add"] } });
  try {
    const { code, json } = t.run("--tasks", "T1..T2");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T1", "T2"], "範囲指定なら足された T4 は回さない");
  } finally { t.cleanup(); }
  t = setup({ todo: TWO, scenario: { T1: ["hole"], T4: ["complete"], amend: ["abolish"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T4"]);
    assert.ok(t.prompts().includes("/execute-task T4"));
  } finally { t.cleanup(); }
});

test("T が尽きて次の一手が /breakdown なら送り、足された T で続ける。範囲指定なら送らず next_step に出す", () => {
  const one = ["| #1-1 | T1 | 一つ目 | — | [ ] |", "", "**#1-1 / T1** — 完了条件: 対象: `src/`。", ""].join("\n");
  let t = setup({ todo: one, scenario: { T1: ["stage_end"], T4: ["complete"], T5: ["complete"], breakdown: ["land"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T1", "T4", "T5"]);
    assert.deepEqual(t.prompts().slice(3, 6), ["/clear", "/rename plan breakdown", "/breakdown docs/design/plan.md"]);
  } finally { t.cleanup(); }
  t = setup({ todo: one, scenario: { T1: ["stage_end"], breakdown: ["land"] } });
  try {
    const { code, json } = t.run("--tasks", "T1");
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.next_step, { command: "breakdown", arg: "docs/design/plan.md" });
    assert.ok(!t.prompts().some((p) => p.includes("breakdown")), "範囲指定では /breakdown を送らない");
  } finally { t.cleanup(); }
  t = setup({ todo: one, scenario: { T1: ["stage_end"], breakdown: ["nothing"] } });
  try {
    const { json } = t.runAuto();
    assert.equal(json.reason, "breakdown_incomplete");
  } finally { t.cleanup(); }
});

test("未着手の T が無くても次の一手が /breakdown なら起動して送る", () => {
  const t = setup({ todo: "| #1-1 | T1 | 済み | — | [x] |\n\n", scenario: { T4: ["complete"], T5: ["complete"], breakdown: ["land"] } });
  try {
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "## 次セッションの最初の一手\n\n- `/breakdown docs/design/plan.md`(段階 2)\n");
    git(t.root, "add", "-A");
    git(t.root, "commit", "-qm", "handoff");
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T4", "T5"]);
    assert.equal(t.prompts()[2], "/breakdown docs/design/plan.md");
  } finally { t.cleanup(); }
});

test("amend が是正タスクを足して次の一手をそこへ向けたら、その T から続けて元の T へ戻る", () => {
  const t = setup({ todo: TWO, scenario: { T1: ["hole", "complete"], T2: ["complete"], T4: ["complete"], amend: ["land_fix"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T4", "T1", "T2"]);
  } finally { t.cleanup(); }
});

test("履歴に T 由来の amend が既に 2 件あれば、打ち直した後のループでも amend を送らずに止まる", () => {
  const t = setup({ scenario: { T1: ["hole"], amend: ["land"] } });
  try {
    git(t.root, "commit", "-q", "--allow-empty", "-m", "amend: repo の設計を改訂(T1 由来)");
    git(t.root, "commit", "-q", "--allow-empty", "-m", "amend: repo の設計を改訂(T1 由来)");
    const { json } = t.run("--tasks", "T1");
    assert.equal(json.reason, "amend_repeated");
    assert.equal(t.state().amendSent, undefined);
  } finally { t.cleanup(); }
});

test("段階の最後の T が次の一手を /breakdown にしたら、キューに別の T が残っていても次の T の前に送る", () => {
  const t = setup({ todo: TWO, scenario: { T1: ["stage_end"], T2: ["complete"], T4: ["complete"], T5: ["complete"], breakdown: ["land"] } });
  try {
    const { code, json } = t.runAuto();
    assert.equal(code, 0, JSON.stringify(json));
    assert.deepEqual(json.tasks_done, ["T1", "T2", "T4", "T5"]);
    assert.deepEqual(t.prompts().slice(3, 6), ["/clear", "/rename plan breakdown", "/breakdown docs/design/plan.md"], "T2 より先に分解する");
  } finally { t.cleanup(); }
});
