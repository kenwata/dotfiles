#!/usr/bin/env node
// 連続実行ループ: 利用者が手で打っていた「/clear → /execute-task T<n>」を、herdr で動いている対話セッションへ
// 機械的に送り、T を 1 件ずつ新しいセッションで実行する。進む・再送する・止まるの判定は成果物だけで行う。
//
// 呼び出し規約(herdr のペインの中の端末から。HERDR_ENV=1 が要る。zsh の alias `task-loop` = `node <このファイル> run`):
//   task-loop                       … カレントディレクトリのプロジェクトで、TODO.md の未着手の T を上から順に回す
//   task-loop T12..T16              … 範囲(T12,T15 の列挙、混在も可)。--tasks <指定> でも同じ
//   task-loop --target <pane_id|名前> … 送る先のペインを指定する。省略時は同じプロジェクト(git ルート)で入力待ちの
//                                    Claude / Codex のペインを herdr から探す(同じタブを優先)。無ければ隣にペインを作って
//                                    起動する(--kind claude|codex、--model <ID> で起動時のモデル)
//   その他: [--root <プロジェクトルート>] [--retry-max <回数>] [--task-timeout-min <分。既定 180>]
//          [--clear-timeout-ms <既定 30000>] [--settle-sec <既定 90>] [--no-follow-up] [--dry-run]
//   checkpoint 以後の完了が 5 件に達したら、次の T を送る前に新しいセッションで /follow-up を送る(既定)。checkpoint の
//   コミット(trailer Follow-Up-Checkpoint: true)が増えたら続け、/follow-up が利用者への問いで止まれば(blocked)そこで止まる。
//   --no-follow-up なら 5 件で follow_up_required として止まる
//   Claude のセッションには名前を付ける(窓の題名と /resume の一覧に出る)。自動起動は `claude --name "<計画> loop"`、
//   /clear の後は毎回 `/rename <計画> T<n>`(/follow-up の前は `<計画> follow-up`)。<計画> は T が属する TODO.md の
//   `## #<n> <slug>` の slug で、無ければリポジトリのディレクトリ名
//
// 経緯(2026-09-23): 利用者はタスクの間で /clear を打ち、compact(自動要約)による情報消失を避けてきた。複数の T を
// 続けて回したいが、1 つのセッションで続けるとコンテキストが積み上がる。そこで T ごとに /clear した新しい
// セッションで /execute-task を送る。claude -p を使わないのは、-p が最終応答の約 5 秒後にバックグラウンドの
// Bash を殺し、Codex worker の待機(templates/codex-worker.md「起動」)と衝突するため。
//
// T ごとの流れ: 前提検査(T の状態・依存・checkpoint 以後の完了数)→ /clear → session_id の変化を待つ →
// sessions/<id>.json に loop を書く(check-stop-question.sh はこのセッションを差し戻さない)→ /execute-task を
// --wait で送る → 落ち着くのを待つ(worker のロック中・working の間は待ち、idle が --settle-sec 続いたら判定)→
// 判定(decide.mjs の judge)。Codex は /clear では session_id が変わらないので、$execute-task を送ってから変化を
// 確かめて loop を書く(openTurn)。
//   next  : TODO.md の T が [x] ∧ T を含むコミットが増えた ∧ 作業ツリーが clean
//   retry : 予算停止(hook が budget を書いた)。同じ T を新しいセッションで再送し、/execute-task が作業記録から再開する
//   stop  : それ以外(穴の記録・関門の質問・blocked・timeout・compact など)。人の判断を待つ
//
// 出力規約: 終了時に JSON を 1 つ stdout に出し、${XDG_STATE_HOME:-~/.local/state}/claude-task-loop/last-run.json にも
// 書く。進行は stderr に [loop T<n>] で始まる行で出す。exit 0 = 全 T を完了、1 = 途中で止まった、2 = 前提検査で止まった。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { activeWorkerLock, gitRoot } from "../../check-task-scope.mjs";
import {
  checkpointSince, committedSince, completedSinceCheckpoint, dirtyPaths, findTask, handoffSignals, headOf, judge, openDependencies, openTasks, parseTaskList, planSlug,
} from "./decide.mjs";
import { HerdrError, agentGet, agentList, agentPrompt, agentRead, agentStart, agentWait, available, paneSplit, paneTitle } from "./herdr.mjs";
import { loopStateDir, readConfig, readSession, sweep, updateSession } from "./session-state.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const WORKER_CLI = path.join(here, "..", "codex-worker", "cli.mjs");
const POLL_MS = 5_000;
const CHECKPOINT_LIMIT = 5;

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const log = (task, text) => process.stderr.write(`[loop${task ? " " + task : ""}] ${text}\n`);

function finish(result, code) {
  const out = { ...result, at: new Date().toISOString() };
  const text = JSON.stringify(out, null, 2);
  try {
    fs.mkdirSync(loopStateDir(), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path.join(loopStateDir(), "last-run.json"), text);
  } catch { /* stdout には出す */ }
  process.stdout.write(text + "\n");
  process.exitCode = code;
}

// 窓がどの計画のどの段を回しているかを名前だけで分かるようにする(2026-09-24、利用者の要望)
const sessionName = (root, task, label = task) => `${planSlug(root, task) ?? path.basename(root)} ${label}`;

// 同じ T の再開の照合は runner の resume(正は codex-worker/cli.mjs)を呼ぶ
function resumeCheck(root, task) {
  const result = spawnSync(process.execPath, [WORKER_CLI, "resume", "--root", root, "--task", task], { encoding: "utf8" });
  try { return JSON.parse(result.stdout); } catch { return null; }
}

// --target が無い時に送る先を決める。同じプロジェクト(git ルート)で入力待ちの Claude / Codex のペインを、
// 呼び出し元と同じタブを優先して 1 つ選ぶ。無ければ隣にペインを作って起動する(このターンの利用者の
// 手作業を無くすため)。起動する時は { start } を返し、起動は startAgent に任せる。候補が複数なら選ばず止まる
function pickAgent(root, args, launchName) {
  let agents;
  try { agents = agentList(); } catch (error) { return { errors: [`herdr agent list に失敗: ${error.message}`] }; }
  const inRoot = agents.filter((a) => (a.agent === "claude" || a.agent === "codex") && a.pane_id !== process.env.HERDR_PANE_ID
    && gitRoot(a.foreground_cwd ?? a.cwd ?? "") === root); // 呼び出し元のペイン(ループを動かしている側)は送る先にしない
  const ready = inRoot.filter((a) => ["idle", "done"].includes(a.agent_status));
  const sameTab = ready.filter((a) => a.tab_id && a.tab_id === process.env.HERDR_TAB_ID);
  const pool = sameTab.length > 0 ? sameTab : ready;
  if (pool.length === 1) return { agent: pool[0] };
  if (pool.length > 1) {
    return { errors: [`同じプロジェクトで入力待ちのペインが複数ある。--target で選ぶ: ${pool.map((a) => `${a.pane_id}(${a.agent})`).join(", ")}`] };
  }
  if (inRoot.length > 0) {
    return { errors: [`同じプロジェクトのペイン ${inRoot.map((a) => `${a.pane_id}(${a.agent_status})`).join(", ")} が入力待ちではない。終わるのを待つか、--target で別のペインを選ぶ`] };
  }
  const kind = args.kind ?? "claude";
  // Codex には起動時に名前を付ける引数が無い
  return { start: { kind, args: [...(kind === "claude" ? ["--name", launchName] : []), ...(args.model ? ["--model", args.model] : [])] } };
}

// 呼び出し元のペインの隣にペインを作り、start.kind のエージェントを start.args で起動する
function startAgent(root, start) {
  const name = `task-loop-${Date.now().toString(36)}`;
  try {
    const pane = paneSplit({ cwd: root });
    const started = agentStart(name, { kind: start.kind, pane, args: start.args });
    const agent = { ...(started ?? agentGet(pane)), pane_id: pane };
    return { agent, started: { pane, name, kind: start.kind } };
  } catch (error) {
    const hint = error.code === "agent_not_ready"
      ? "(新しいペインで確認の画面(フォルダの信頼など)が出ている。答えてから task-loop をもう一度打つ)"
      : "";
    return { errors: [`ペインの自動起動に失敗: ${error.message}${hint}`] };
  }
}

function agentErrors(target, agent) {
  const errors = [];
  if (agent.agent !== "claude" && agent.agent !== "codex") errors.push(`${target} は claude / codex ではない(${agent.agent})`);
  if (!["idle", "done"].includes(agent.agent_status)) errors.push(`${target} が入力を受け付ける状態ではない(${agent.agent_status})`);
  return errors;
}

// 送る先のペインの自動起動は最後に回す。起動時の名前に最初の T が要り、前提検査で止まる時にペインを残さないため
function preflight(args, positionalTasks) {
  if (!available()) return { errors: ["herdr の中で実行していない(HERDR_ENV=1 と herdr が要る)"] };
  const errors = [];
  let root = args.root ? gitRoot(path.resolve(args.root)) : null;
  let agent = null;
  let started = null;
  if (args.target) {
    try { agent = agentGet(args.target); } catch (error) { return { errors: [`${args.target} を herdr で見つけられない: ${error.message}`] }; }
    root ??= gitRoot(path.resolve(agent.foreground_cwd ?? agent.cwd ?? "."));
    if (!root) return { errors: [`git のリポジトリではない: ${args.root ?? agent.cwd}`] };
    errors.push(...agentErrors(args.target, agent));
  } else {
    root ??= gitRoot(process.cwd());
    if (!root) return { errors: ["--target も --root も無く、カレントディレクトリが git のリポジトリでもない"] };
  }
  if (!fs.existsSync(path.join(root, "TODO.md"))) errors.push(`TODO.md が無い: ${root}`);
  if (errors.length > 0) return { errors };

  const spec = args.tasks ?? positionalTasks ?? null;
  const parsed = spec ? parseTaskList(spec) : { tasks: openTasks(root), errors: [] };
  errors.push(...parsed.errors);
  if (!spec && parsed.tasks.length === 0) errors.push(`TODO.md に未着手([ ])の T が無い: ${root}`);
  if (errors.length > 0) return { errors };
  const tasks = parsed.tasks;

  const dirty = dirtyPaths(root);
  if (dirty.length > 0) {
    const resume = resumeCheck(root, tasks[0]);
    if (!resume?.exists || (resume.unexplained_dirty ?? dirty).length > 0) {
      errors.push(`作業ツリーに未コミットの変更がある(${tasks[0]} の作業記録で説明できない): ${(resume?.unexplained_dirty ?? dirty).join(", ")}`);
    }
  }
  if (errors.length > 0) return { errors };

  const tasksFrom = spec ? "args" : "TODO.md";
  if (!agent) {
    const picked = pickAgent(root, args, sessionName(root, tasks[0], "loop"));
    if (picked.errors) return picked;
    // --dry-run はペインを作らず、起動する予定だけを返す
    if (picked.start && args["dry-run"]) return { errors, tasks, host: picked.start.kind, root, target: null, pane: null, started: null, wouldStart: picked.start, tasksFrom };
    const got = picked.start ? startAgent(root, picked.start) : picked;
    if (got.errors) return got;
    agent = got.agent;
    started = got.started ?? null;
    errors.push(...agentErrors(agent.pane_id, agent));
  }
  const target = args.target ?? agent.pane_id;
  return { errors, tasks, host: agent.agent, root, target, pane: agent.pane_id, started, tasksFrom };
}

// 送った後、成果物の判定に進んでよいところまで待つ。Codex worker の実行中(ロック)と working の間は待ち、
// idle / done が settle の間続いたら落ち着いたとみなす(worker の完了通知で監督のターンが再開する間を空ける)
function settle(ctx, deadline, isComplete) {
  let quietSince = null;
  for (;;) {
    if (Date.now() > deadline) return { stop: "timeout" };
    if (isComplete()) return {};
    let agent;
    try { agent = agentGet(ctx.target); } catch (error) { return { stop: "herdr_error", detail: error.message }; }
    if (agent.agent_status === "blocked") return { stop: "blocked" };
    if (agent.agent_status === "unknown") return { stop: "unknown" };
    if (agent.agent_status === "working") {
      quietSince = null;
      try { agentWait(ctx.target, { timeoutMs: Math.max(1_000, Math.min(deadline - Date.now(), 10 * 60_000)) }); } catch (error) {
        if (error.code !== "timeout") return { stop: "herdr_error", detail: error.message };
      }
      continue;
    }
    if (activeWorkerLock(ctx.root)) {
      quietSince = null;
      sleep(POLL_MS);
      continue;
    }
    quietSince ??= Date.now();
    if (Date.now() - quietSince >= ctx.settleMs) return {};
    sleep(POLL_MS);
  }
}

// 新しいセッションに名前を付ける。/clear の後のセッションは前の名前を引き継ぐので、T ごとに付け直す
// (2026-09-24 実測: --name の名前は /clear の後も残り、/rename は確認の画面を出さず 1 秒ほどで端末の題名に出る)。
// 引き継いだ名前が既に同じ(同じ T の再送)なら送らない。
// 名前は表示のためだけなので、題名に出なくても止めずに stderr へ書いて進む(続く /execute-task が届かなければ判定が止める)。
// Codex には送らない。/rename が herdr の 1 回の送信では確定せず、入力欄に残る(同日実測)
function nameSession(ctx, name, logTask) {
  if (ctx.host !== "claude") return;
  try {
    if (paneTitle(ctx.pane) === name) return;
    agentPrompt(ctx.target, `/rename ${name}`);
    const deadline = Date.now() + ctx.clearTimeoutMs;
    while (paneTitle(ctx.pane) !== name) {
      if (Date.now() > deadline) { log(logTask, `rename: ${ctx.clearTimeoutMs}ms 待っても端末の題名が "${name}" にならない`); return; }
      sleep(250);
    }
  } catch (error) {
    log(logTask, `rename: 失敗 ${error.message}`);
  }
}

const CLEAR_ERRORS = new Set(["blocked_after_clear", "clear_not_detected"]);
const PROMPT_ERRORS = { agent_blocked: "blocked_before_send", agent_prompt_stalled: "stalled", timeout: "timeout" };

// session_id が before 以外になるのを --clear-timeout-ms まで待つ。変わらなければ null
function waitSessionChange(ctx, before) {
  const deadline = Date.now() + ctx.clearTimeoutMs;
  for (;;) {
    const now = agentGet(ctx.target).agent_session?.value ?? null;
    if (now && now !== before) return now;
    if (Date.now() > deadline) return null;
    sleep(500);
  }
}

// /clear を送って新しいセッションを始める。戻り値の before は送る前の session_id、session は新しい session_id。
// Claude は /clear で session_id が変わるので、それを待って名前を付ける。Codex は /clear では変わらず、最初の発言で
// 新しい会話ができて SessionStart が走り、そこで herdr に session_id が届く(2026-09-24 実測)ので session は null。
// Codex で /new を使わないのは、worktrees 機能(既定で有効)が「どこで動かすか」の選択画面を出して止まるため(同日実測)
function clearSession(ctx, name, logTask) {
  const before = agentGet(ctx.target).agent_session?.value ?? null;
  agentPrompt(ctx.target, "/clear");
  const session = ctx.host === "codex" ? null : waitSessionChange(ctx, before);
  if (ctx.host !== "codex" && !session) throw new HerdrError("clear_not_detected", `${ctx.clearTimeoutMs}ms 待っても session_id が変わらない`);
  const settled = agentWait(ctx.target, { timeoutMs: 30_000 });
  if (settled?.agent_status === "blocked") throw new HerdrError("blocked_after_clear", "新しいセッションが承認・質問の画面で止まっている");
  nameSession(ctx, name, logTask);
  return { before, session };
}

// 新しいセッションで text を送り、送った後の最初の落ち着いた状態(idle / done / blocked)まで待つ。
// 戻り値は { session, agent }、または止まる理由 { stop, session?, details? }。sessions/<id>.json の loop は、Claude なら
// 送る前に書く(check-stop-question.sh がこのセッションを差し戻さないように)。Codex は送った後に session_id が
// 変わったのを確かめてから書き、変わらなければ止める(送信が確定していないか、前の会話に届いている)。Codex の hook は
// loop を読まないので、書くのが送った後でも差し戻しの扱いは変わらない
function openTurn(ctx, text, { task, attempt }, name, logTask) {
  let cleared;
  try {
    cleared = clearSession(ctx, name, logTask);
  } catch (error) {
    return { stop: CLEAR_ERRORS.has(error.code) ? error.code : "clear_failed", details: { error: error.message } };
  }
  const state = { host: ctx.host, loop: { target: ctx.target, task, root: ctx.root, attempt, started_at: Date.now(), loop_pid: process.pid } };
  let session = cleared.session;
  try {
    if (session) {
      updateSession(session, { ...state, budget: null, compact: null });
      log(logTask, `send "${text}" (session ${session.slice(0, 8)})`);
      return { session, agent: agentPrompt(ctx.target, text, { wait: true, timeoutMs: ctx.taskTimeoutMs }) };
    }
    log(logTask, `send "${text}"`);
    agentPrompt(ctx.target, text);
    session = waitSessionChange(ctx, cleared.before);
    if (!session) {
      return { stop: "new_session_not_detected", details: { error: `送った後 ${ctx.clearTimeoutMs}ms 待っても session_id が変わらない(送信が確定していないか、前の会話に届いた)` } };
    }
    updateSession(session, state);
    log(logTask, `session ${session.slice(0, 8)}`);
    return { session, agent: agentWait(ctx.target, { timeoutMs: ctx.taskTimeoutMs }) };
  } catch (error) {
    return { stop: PROMPT_ERRORS[error.code] ?? "herdr_error", session, details: { error: error.message } };
  }
}

// checkpoint 以後の完了が上限に達した時、次の T の前に /follow-up を新しいセッションで送る。成果物(checkpoint の
// コミットが増えたか)で判定する。/follow-up が利用者への問い(要確認の回収など)で止まれば blocked として人へ渡す
function runFollowUp(ctx, nextTask) {
  const headBefore = headOf(ctx.root);
  const deadline = Date.now() + ctx.taskTimeoutMs;
  log("follow-up", "clear");
  const turn = openTurn(ctx, `${ctx.host === "codex" ? "$" : "/"}follow-up`, { task: "follow-up", attempt: 1 }, sessionName(ctx.root, nextTask, "follow-up"), "follow-up");
  const { session } = turn;
  if (turn.stop) return { action: "stop", reason: turn.stop, session, details: turn.details };
  if (turn.agent?.agent_status === "blocked") return { action: "stop", reason: "follow_up_question", session };
  if (turn.agent?.agent_status === "unknown") return { action: "stop", reason: "unknown", session };
  const settled = settle(ctx, deadline, () => checkpointSince(ctx.root, headBefore));
  if (settled.stop) return { action: "stop", reason: settled.stop === "blocked" ? "follow_up_question" : settled.stop, session, details: settled.detail ? { error: settled.detail } : undefined };
  if (!checkpointSince(ctx.root, headBefore)) return { action: "stop", reason: "follow_up_incomplete", session, details: { dirty: dirtyPaths(ctx.root) } };
  return { action: "continue", session };
}

function runTask(ctx, task, attempt) {
  const info = findTask(ctx.root, task);
  if (!info) return { action: "stop", reason: "task_not_found" };
  if (info.state === "x") return { action: "skip", reason: "already_done" };
  if (info.state === "-") return { action: "stop", reason: "task_closed" };
  const open = openDependencies(ctx.root, task);
  if (open.length > 0) return { action: "stop", reason: "dependency_open", details: { open } };
  let since = completedSinceCheckpoint(ctx.root);
  if (since && since.count >= CHECKPOINT_LIMIT) {
    if (!ctx.followUp || ctx.followUpBefore.has(task)) return { action: "stop", reason: "follow_up_required", details: since };
    ctx.followUpBefore.add(task); // 同じ T の前で /follow-up を繰り返さない
    const outcome = runFollowUp(ctx, task);
    log("follow-up", `${outcome.action}: ${outcome.reason ?? "checkpoint"}`);
    if (outcome.action !== "continue") return outcome;
    since = completedSinceCheckpoint(ctx.root);
    if (since && since.count >= CHECKPOINT_LIMIT) return { action: "stop", reason: "follow_up_required", details: since };
  }

  const headBefore = headOf(ctx.root);
  const deadline = Date.now() + ctx.taskTimeoutMs;
  log(task, `clear (attempt ${attempt})`);
  const turn = openTurn(ctx, `${ctx.host === "codex" ? "$" : "/"}execute-task ${task}`, { task, attempt }, sessionName(ctx.root, task), task);
  const { session } = turn;
  if (turn.stop) return { action: "stop", reason: turn.stop, session, details: turn.details };
  if (turn.agent?.agent_status === "blocked") return { action: "stop", reason: "blocked", session };
  if (turn.agent?.agent_status === "unknown") return { action: "stop", reason: "unknown", session };

  const facts = () => {
    const state = readSession(session);
    let current = null;
    try { current = agentGet(ctx.target).agent_session?.value ?? null; } catch { /* 下の判定で止まる */ }
    return {
      state: findTask(ctx.root, task)?.state ?? null,
      committed: committedSince(ctx.root, headBefore, task),
      dirty: dirtyPaths(ctx.root),
      sessionChanged: current !== null && current !== session,
      compacted: Boolean(state.compact),
      budgetStage: state.budget?.task === task ? Number(state.budget.stage) : 0,
      handoff: handoffSignals(ctx.root, task),
      retries: attempt - 1,
      retryMax: ctx.retryMax,
    };
  };
  const settled = settle(ctx, deadline, () => judge(facts()).action === "next");
  if (settled.stop) return { action: "stop", reason: settled.stop, session, details: settled.detail ? { error: settled.detail } : undefined };
  const f = facts();
  return { ...judge(f), session, details: { budget_stage: f.budgetStage, dirty: f.dirty } };
}

function main() {
  let args;
  try {
    args = parseArgs({
      allowPositionals: true,
      options: {
        target: { type: "string" }, tasks: { type: "string" }, root: { type: "string" }, "retry-max": { type: "string" },
        "task-timeout-min": { type: "string" }, "clear-timeout-ms": { type: "string" }, "settle-sec": { type: "string" },
        "dry-run": { type: "boolean" }, kind: { type: "string" }, model: { type: "string" }, "no-follow-up": { type: "boolean" },
      },
    });
  } catch (error) {
    finish({ stopped: true, reason: "preflight_failed", errors: [error.message] }, 2);
    return;
  }
  if (args.positionals[0] !== "run") {
    finish({ stopped: true, reason: "preflight_failed", errors: ["usage: task-loop [T12..T16] [--target <pane_id|名前>] [--tasks <T12..T16>] [...](= cli.mjs run ...)"] }, 2);
    return;
  }
  const values = args.values;
  const checked = preflight(values, args.positionals[1] ?? null);
  if (checked.errors.length > 0) {
    finish({ stopped: true, reason: "preflight_failed", errors: checked.errors, target: values.target ?? null }, 2);
    return;
  }
  const config = readConfig();
  const ctx = {
    target: checked.target, pane: checked.pane, host: checked.host, root: checked.root,
    retryMax: Number(values["retry-max"] ?? config.retry_max),
    taskTimeoutMs: Number(values["task-timeout-min"] ?? 180) * 60_000,
    clearTimeoutMs: Number(values["clear-timeout-ms"] ?? 30_000),
    settleMs: Number(values["settle-sec"] ?? 90) * 1000,
    followUp: !values["no-follow-up"],
    followUpBefore: new Set(),
  };
  const texts = checked.tasks.map((t) => `${ctx.host === "codex" ? "$" : "/"}execute-task ${t}`);
  log(null, `target ${ctx.target ?? "(隣に起動する)"} (${ctx.host}${checked.started ? "、隣に起動" : ""}) tasks ${checked.tasks.join(",")} (${checked.tasksFrom})`);
  if (values["dry-run"]) {
    finish({ stopped: false, reason: "dry_run", target: ctx.target, host: ctx.host, root: ctx.root, started: checked.started, would_start: checked.wouldStart ?? null, tasks: checked.tasks, tasks_from: checked.tasksFrom, prompts: texts, retry_max: ctx.retryMax, follow_up: ctx.followUp }, 0);
    return;
  }
  sweep();

  const done = [];
  const skipped = [];
  for (const [index, task] of checked.tasks.entries()) {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = runTask(ctx, task, attempt);
      log(task, `${outcome.action}: ${outcome.reason}`);
      if (outcome.action === "next") { done.push(task); break; }
      if (outcome.action === "skip") { skipped.push(task); break; }
      if (outcome.action === "retry") continue;
      finish({
        stopped: true, reason: outcome.reason, task, attempt, session_id: outcome.session ?? null,
        target: ctx.target, host: ctx.host, root: ctx.root,
        tasks_done: done, tasks_skipped: skipped, tasks_remaining: checked.tasks.slice(index),
        details: outcome.details ?? null, tail: agentRead(ctx.target, 80),
      }, 1);
      return;
    }
  }
  finish({ stopped: false, reason: "all_done", target: ctx.target, host: ctx.host, root: ctx.root, tasks_done: done, tasks_skipped: skipped, tasks_remaining: [] }, 0);
}

main();
