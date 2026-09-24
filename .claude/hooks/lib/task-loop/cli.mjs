#!/usr/bin/env node
// 連続実行ループ: 利用者が手で打っていた「/clear → /execute-task T<n>」を、herdr で動いている対話セッションへ
// 機械的に送り、T を 1 件ずつ新しいセッションで実行する。進む・再送する・止まるの判定は成果物だけで行う。
//
// 呼び出し規約(herdr のペインの中の端末から。HERDR_ENV=1 が要る。zsh の alias `task-loop` = `node <このファイル> run`):
//   task-loop                       … カレントディレクトリのプロジェクトで、HANDOFF.md の次の一手から回す。工程を 1 つ
//                                    終えるたびに次の一手を読み直す(各工程が次の一手を書き換える)。TODO.md の並びからは
//                                    選ばない。次の一手が /elaborate・コマンド無し・済んだ T なら止まる
//   task-loop T12..T16              … 範囲(T12,T15 の列挙、混在も可)。--tasks <指定> でも同じ。/breakdown は送らない
//   task-loop --target <pane_id|名前> … 送る先のペインを指定する。省略時は同じプロジェクト(git ルート)で入力待ちの
//                                    Claude / Codex のペインを herdr から探す(同じタブを優先)。無ければ隣にペインを作って
//                                    起動する(--kind claude|codex、--model <ID> で起動時のモデル)
//   その他: [--root <プロジェクトルート>] [--retry-max <回数>] [--task-timeout-min <分。既定 180>]
//          [--clear-timeout-ms <既定 30000>] [--settle-sec <既定 90>] [--no-follow-up] [--dry-run]
//   1 回の起動は /follow-up の 1 区間: checkpoint 以後の完了が 5 件に達したら、次の作業の前に新しいセッションで
//   /follow-up を送り、checkpoint のコミット(trailer Follow-Up-Checkpoint: true)が増えたら follow_up_done で終える
//   (次の区間は打ち直して始める。範囲指定でも同じ)。/follow-up が利用者への問い(blocked)を出せば答えを待つ。
//   --no-follow-up なら /follow-up を送らず follow_up_required として止まる
//   Claude のセッションには名前を付ける(窓の題名と /resume の一覧に出る)。自動起動は `claude --name "<計画> loop"`、
//   /clear の後は毎回 `/rename <計画> T<n>`(/follow-up の前は `<計画> follow-up`、/amend は `<計画> T<n> amend`、
//   /breakdown は `<設計書の slug> breakdown`)。<計画> は T が属する TODO.md の
//   `## #<n> <slug>` の slug で、無ければリポジトリのディレクトリ名
//
// 経緯(2026-09-23): 利用者はタスクの間で /clear を打ち、compact(自動要約)による情報消失を避けてきた。複数の T を
// 続けて回したいが、1 つのセッションで続けるとコンテキストが積み上がる。そこで T ごとに /clear した新しい
// セッションで /execute-task を送る。claude -p を使わないのは、-p が最終応答の約 5 秒後にバックグラウンドの
// Bash を殺し、Codex worker の待機(templates/codex-worker.md「起動」)と衝突するため。
//
// 作業ごとに、送る前に checkpoint 以後の完了数を見る(上限なら /follow-up で区間を閉じる)。
// T ごとの流れ: 前提検査(T の状態・依存)→ /clear → session_id の変化を待つ →
// sessions/<id>.json に loop を書く(check-stop-question.sh はこのセッションを差し戻さない)→ /execute-task を
// --wait で送る → 落ち着くのを待つ(worker のロック中・working の間は待ち、idle が --settle-sec 続いたら判定)→
// 判定(decide.mjs の judge)。Codex は /clear では session_id が変わらないので、$execute-task を送ってから変化を
// 確かめて loop を書く(openTurn)。
//   next  : TODO.md の T が [x] ∧ T を含むコミットが増えた ∧ 作業ツリーが clean
//   retry : 予算停止(hook が budget を書いた)。同じ T を新しいセッションで再送し、/execute-task が作業記録から再開する
//   amend : 穴の記録(HANDOFF.md の次の一手が /amend T<n>)。新しいセッションで /amend T<n> を送り(runAmend)、着地したら
//           次の一手が指す T(元の T・置き換え先・足された是正タスク)を attempt 1 から送る。同じ T でこのループ 2 回目の穴、
//           または履歴に T 由来の amend が既に 2 件ある時は amend_repeated で止まる
//   stop  : それ以外(次の一手が /elaborate・timeout・compact など)。人の判断を待つ
// 引数なしで T の間に読む次の一手が回せない時の停止理由: next_step_not_runnable(/elaborate・コマンド無し・引数の形が違う)/
// next_step_not_open(済んだ T・廃止した T を指す)/ breakdown_repeated(同じ設計書の /breakdown が T の完了を挟まずに続いた)
// 問い(AskUserQuestion・承認の画面)で blocked になっても止めず、人が答えて動き出すまで待つ(settle)。blocked の間は
// タスクの制限時間に数えない。/elaborate は対話で詰める工程なのでループに入れない(2026-09-24 利用者決定)。
// 計画工程: 引数なしの時は、次の一手が /breakdown docs/design/<slug>.md なら送り(runBreakdown)、/amend T<n> なら送る。
// T を位置引数・--tasks で指定した時は範囲を「ここまで」と読み、/breakdown を送らない(範囲が済めば all_done、次の一手は
// next_step に出す)。/amend・/breakdown が途中で止まった時の再開は無い(人が片付けて打ち直す)
// 経緯(2026-09-24): 引数なしの既定を「TODO.md の未着手を上から順に」にしていたため、表の先頭にあった凍結中の T47 を
// 2 回送り、HANDOFF.md の次の一手(T142)に進まなかった。また /follow-up の後も次の区間へ進み続ける作りで、
// 利用者の意図(1 回の起動 = /follow-up の 1 区間)と違っていた。どちらも利用者の決定ではなく実装の誤り
//
// 出力規約: 終了時に JSON を 1 つ stdout に出し、${XDG_STATE_HOME:-~/.local/state}/claude-task-loop/last-run.json にも
// 書く。進行は stderr に [loop T<n>] で始まる行で出す。exit 0 = 区間を閉じた(follow_up_done)か回す作業が尽きた
// (all_done)、1 = 途中で止まった、2 = 前提検査で止まった。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import { activeWorkerLock, gitRoot } from "../../check-task-scope.mjs";
import {
  amendCount, amendOutcome, breakdownOutcome, checkpointSince, committedSince, completedSinceCheckpoint, dirtyPaths, findTask, handoffSignals, headOf, judge,
  loopStep, nextStep, openDependencies, openTasks, parseTaskList, planSlug,
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
  const parsed = spec ? parseTaskList(spec) : handoffTasks(root);
  errors.push(...parsed.errors);
  if (errors.length > 0) return { errors };
  const tasks = parsed.tasks;
  const step = parsed.step ?? null;

  const dirty = dirtyPaths(root);
  if (dirty.length > 0 && tasks.length === 0) return { errors: [`作業ツリーに未コミットの変更がある: ${dirty.join(", ")}`] };
  if (dirty.length > 0) {
    const resume = resumeCheck(root, tasks[0]);
    if (!resume?.exists || (resume.unexplained_dirty ?? dirty).length > 0) {
      errors.push(`作業ツリーに未コミットの変更がある(${tasks[0]} の作業記録で説明できない): ${(resume?.unexplained_dirty ?? dirty).join(", ")}`);
    }
  }
  if (errors.length > 0) return { errors };

  const tasksFrom = spec ? "args" : "HANDOFF.md";
  if (!agent) {
    const picked = pickAgent(root, args, sessionName(root, tasks[0], "loop"));
    if (picked.errors) return picked;
    // --dry-run はペインを作らず、起動する予定だけを返す
    if (picked.start && args["dry-run"]) return { errors, tasks, step, host: picked.start.kind, root, target: null, pane: null, started: null, wouldStart: picked.start, tasksFrom };
    const got = picked.start ? startAgent(root, picked.start) : picked;
    if (got.errors) return got;
    agent = got.agent;
    started = got.started ?? null;
    errors.push(...agentErrors(agent.pane_id, agent));
  }
  const target = args.target ?? agent.pane_id;
  return { errors, tasks, step, host: agent.agent, root, target, pane: agent.pane_id, started, tasksFrom };
}

// 引数なしの起動で最初に回す工程(HANDOFF.md の次の一手。decide.mjs の loopStep)。tasks は /execute-task・/amend の T
// (未コミットの変更の照合とセッション名に使う)。回せなければ何も送らずに前提検査で止まる
function handoffTasks(root) {
  const { step, error } = loopStep(root);
  const shown = step ? `/${step.command}${step.arg ? " " + step.arg : ""}` : null;
  if (error === "not_open") return { tasks: [], errors: [`HANDOFF.md の次の一手 ${shown} の ${step.arg} は未着手([ ])ではない。次の一手を直すか、T を引数で指定する: ${root}`] };
  if (error) {
    return {
      tasks: [],
      errors: [shown
        ? `HANDOFF.md の次の一手 ${shown} は task-loop が回す工程(/execute-task・/amend・/breakdown・/follow-up)ではないか、引数の形が違う: ${root}`
        : `HANDOFF.md の次の一手(「次セッションの最初の一手」節)に task-loop が回す工程(/execute-task・/amend・/breakdown・/follow-up)が無い: ${root}`],
    };
  }
  return { tasks: step.command === "execute-task" || step.command === "amend" ? [step.arg] : [], step, errors: [] };
}

// 送った後、成果物の判定に進んでよいところまで待つ。Codex worker の実行中(ロック)と working の間は待ち、
// idle / done が settle の間続いたら落ち着いたとみなす(worker の完了通知で監督のターンが再開する間を空ける)。
// blocked(AskUserQuestion・承認の画面)は人の答えを待つ。答えると約 1 秒で working に戻る(2026-09-24 実測:
// blocked → 回答 → working → idle)。blocked の間は制限時間に数えない。制限時間はエージェントの停滞を見るためのもので、
// 人の応答の遅さは別物だから。待つ間の上限は設けない(窓の題名が <計画> T<n> / amend / breakdown のまま残り、何を
// 待たれているかは見える)
function settle(ctx, deadline, isComplete, logTask) {
  let quietSince = null;
  let limit = deadline;
  for (;;) {
    if (Date.now() > limit) return { stop: "timeout" };
    if (isComplete()) return {};
    let agent;
    try { agent = agentGet(ctx.target); } catch (error) { return { stop: "herdr_error", detail: error.message }; }
    if (agent.agent_status === "blocked") {
      const blockedAt = Date.now();
      quietSince = null;
      log(logTask, "blocked: 利用者の答えを待つ");
      try {
        for (;;) {
          try { agentWait(ctx.target, { until: ["working", "idle", "done", "unknown"], timeoutMs: 10 * 60_000 }); break; } catch (error) {
            if (error.code !== "timeout") throw error;
          }
        }
      } catch (error) { return { stop: "herdr_error", detail: error.message }; }
      limit += Date.now() - blockedAt;
      log(logTask, "blocked: 答えを受けて再開");
      continue;
    }
    if (agent.agent_status === "unknown") return { stop: "unknown" };
    if (agent.agent_status === "working") {
      quietSince = null;
      try { agentWait(ctx.target, { timeoutMs: Math.max(1_000, Math.min(limit - Date.now(), 10 * 60_000)) }); } catch (error) {
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

// 区間を閉じる /follow-up を新しいセッションで送る(checkpoint 以後の完了が上限に達した時と、次の一手が /follow-up の時)。成果物(checkpoint の
// コミットが増えたか)で判定する。/follow-up が利用者への問い(要確認の回収など)を出せば、答えを待つ(settle)
function runFollowUp(ctx, nextTask) {
  const headBefore = headOf(ctx.root);
  const deadline = Date.now() + ctx.taskTimeoutMs;
  log("follow-up", "clear");
  const turn = openTurn(ctx, `${ctx.host === "codex" ? "$" : "/"}follow-up`, { task: "follow-up", attempt: 1 }, sessionName(ctx.root, nextTask, "follow-up"), "follow-up");
  const { session } = turn;
  if (turn.stop) return { action: "stop", reason: turn.stop, session, details: turn.details };
  if (turn.agent?.agent_status === "unknown") return { action: "stop", reason: "unknown", session };
  const settled = settle(ctx, deadline, () => checkpointSince(ctx.root, headBefore), "follow-up");
  if (settled.stop) return { action: "stop", reason: settled.stop, session, details: settled.detail ? { error: settled.detail } : undefined };
  if (!checkpointSince(ctx.root, headBefore)) return { action: "stop", reason: "follow_up_incomplete", session, details: { dirty: dirtyPaths(ctx.root) } };
  return { action: "continue", session };
}

// 計画工程(/amend・/breakdown)を新しいセッションで送り、outcome(root) が "done" になるか落ち着くまで待つ。
// 戻り値の outcome は "done" / "elaborate" / "incomplete"(decide.mjs の amendOutcome・breakdownOutcome)。
// 予算停止は再送しない(計画工程は作業記録から再開する仕組みを持たない)。落ち着いた時点の outcome で決める
function runPlanning(ctx, { label, text, loopTask, name, outcome }) {
  const deadline = Date.now() + ctx.taskTimeoutMs;
  log(label, "clear");
  const turn = openTurn(ctx, text, { task: loopTask, attempt: 1 }, name, label);
  const { session } = turn;
  if (turn.stop) return { stop: turn.stop, session, details: turn.details };
  if (turn.agent?.agent_status === "unknown") return { stop: "unknown", session };
  const settled = settle(ctx, deadline, () => outcome() === "done", label);
  if (settled.stop) return { stop: settled.stop, session, details: settled.detail ? { error: settled.detail } : undefined };
  const state = readSession(session);
  if (state.compact) return { stop: "compacted", session };
  return { outcome: outcome(), session };
}

// 穴の記録で止まった T に /amend T<n> を送る。amend.md 手順 5 の承認は人が答える(ループは blocked の間待つ)。
// 着地(amendOutcome が done。次の一手が未着手の T の /execute-task になった)なら continue、次の一手が /elaborate なら amend_to_elaborate、それ以外は amend_incomplete
function runAmend(ctx, task) {
  const headBefore = headOf(ctx.root);
  const r = runPlanning(ctx, {
    label: "amend", text: `${ctx.host === "codex" ? "$" : "/"}amend ${task}`, loopTask: task, name: sessionName(ctx.root, task, `${task} amend`),
    outcome: () => amendOutcome(ctx.root, headBefore),
  });
  if (r.stop) return { action: "stop", reason: r.stop, session: r.session, details: r.details };
  if (r.outcome === "done") return { action: "continue", session: r.session };
  return { action: "stop", reason: r.outcome === "elaborate" ? "amend_to_elaborate" : "amend_incomplete", session: r.session, details: { next_step: nextStep(ctx.root), dirty: dirtyPaths(ctx.root) } };
}

// 次の一手が /breakdown docs/design/<slug>.md の時に送る。承認・本流の計器の問いは人が答える。
// 着地(breakdownOutcome が done: コミットと新しい [ ] の T)なら continue。セッション名は設計書の slug(まだ T が無い)
function runBreakdown(ctx, design) {
  const headBefore = headOf(ctx.root);
  const openBefore = openTasks(ctx.root);
  const r = runPlanning(ctx, {
    label: "breakdown", text: `${ctx.host === "codex" ? "$" : "/"}breakdown ${design}`, loopTask: "breakdown", name: `${path.basename(design, ".md")} breakdown`,
    outcome: () => breakdownOutcome(ctx.root, headBefore, openBefore),
  });
  if (r.stop) return { action: "stop", reason: r.stop, session: r.session, details: r.details };
  if (r.outcome === "done") return { action: "continue", session: r.session };
  return { action: "stop", reason: r.outcome === "elaborate" ? "breakdown_to_elaborate" : "breakdown_incomplete", session: r.session, details: { next_step: nextStep(ctx.root), dirty: dirtyPaths(ctx.root) } };
}

function runTask(ctx, task, attempt, { amended = false } = {}) {
  const info = findTask(ctx.root, task);
  if (!info) return { action: "stop", reason: "task_not_found" };
  if (info.state === "x") return { action: "skip", reason: "already_done" };
  if (info.state === "-") return { action: "stop", reason: "task_closed" };
  const open = openDependencies(ctx.root, task);
  if (open.length > 0) return { action: "stop", reason: "dependency_open", details: { open } };

  const headBefore = headOf(ctx.root);
  const deadline = Date.now() + ctx.taskTimeoutMs;
  log(task, `clear (attempt ${attempt})`);
  const turn = openTurn(ctx, `${ctx.host === "codex" ? "$" : "/"}execute-task ${task}`, { task, attempt }, sessionName(ctx.root, task), task);
  const { session } = turn;
  if (turn.stop) return { action: "stop", reason: turn.stop, session, details: turn.details };
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
      amended,
    };
  };
  const settled = settle(ctx, deadline, () => judge(facts()).action === "next", task);
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
  };
  const texts = checked.step ? [stepText(ctx.host, checked.step)] : checked.tasks.map((t) => stepText(ctx.host, { command: "execute-task", arg: t }));
  log(null, `target ${ctx.target ?? "(隣に起動する)"} (${ctx.host}${checked.started ? "、隣に起動" : ""}) ${checked.step ? `next ${texts[0]}` : `tasks ${checked.tasks.join(",")}`} (${checked.tasksFrom})`);
  if (values["dry-run"]) {
    finish({ stopped: false, reason: "dry_run", target: ctx.target, host: ctx.host, root: ctx.root, started: checked.started, would_start: checked.wouldStart ?? null, tasks: checked.tasks, tasks_from: checked.tasksFrom, prompts: texts, retry_max: ctx.retryMax, follow_up: ctx.followUp }, 0);
    return;
  }
  sweep();
  runLoop(ctx, checked);
}

// 送る文。Claude は /<工程>、Codex は $<工程>
const stepText = (host, step) => `${host === "codex" ? "$" : "/"}${step.command}${step.arg ? " " + step.arg : ""}`;

// 1 回の起動で /follow-up の 1 区間を回す。区間は最新の checkpoint 以後の完了が 5 件に達するまでで、達したら次の作業の
// 前に /follow-up を送り、checkpoint が増えたら follow_up_done で終える(次の区間は打ち直して始める)。
// 次に回す作業は、引数なし(tasksFrom が HANDOFF.md)なら毎回 HANDOFF.md の次の一手(loopStep)から決める。各工程が
// 次の一手を書き換えるので、/amend・/breakdown の後もそのまま続く。引数で T を指定した時は、その範囲を上から回す
function runLoop(ctx, checked) {
  const fromHandoff = checked.tasksFrom === "HANDOFF.md";
  let queue = fromHandoff ? [] : [...checked.tasks];
  const done = [];
  const skipped = [];
  const amended = new Set();
  let lastBreakdown = null;
  const handled = (t) => done.includes(t) || skipped.includes(t);
  const base = () => ({ target: ctx.target, host: ctx.host, root: ctx.root, tasks_done: done, tasks_skipped: skipped });
  const stop = (outcome, task, attempt) => finish({
    stopped: true, reason: outcome.reason, task, attempt, session_id: outcome.session ?? null, ...base(),
    tasks_remaining: queue, next_step: nextStep(ctx.root), details: outcome.details ?? null, tail: agentRead(ctx.target, 80),
  }, 1);

  // 区間を閉じる: /follow-up を送り、checkpoint が増えたら終える。--no-follow-up なら送らずに止まる
  const closeInterval = (nextTask) => {
    if (!ctx.followUp) { stop({ reason: "follow_up_required", details: completedSinceCheckpoint(ctx.root) }, nextTask, null); return; }
    const outcome = runFollowUp(ctx, nextTask);
    log("follow-up", `${outcome.action}: ${outcome.reason ?? "checkpoint"}`);
    if (outcome.action !== "continue") { stop(outcome, nextTask, null); return; }
    finish({ stopped: false, reason: "follow_up_done", ...base(), tasks_remaining: queue, next_step: nextStep(ctx.root) }, 0);
  };

  // 範囲指定の時: amend が廃止した T は置き換え先へ読み替え(無ければ外し)、重複を除く
  const settleQueue = (list) => {
    const out = [];
    for (const t of list) {
      const info = findTask(ctx.root, t);
      const id = info?.state === "-" ? info.replacedBy : t;
      if (id && !out.includes(id) && !handled(id)) out.push(id);
    }
    return out;
  };

  // 穴の記録の T に /amend を送る。同じ T の amend はこのループで 1 回まで。履歴に T 由来の amend が既に 2 件あれば送らない
  // (amend.md「同じ T<n> に 3 回目を実行する前に止める」。git log から数えるので打ち直しをまたいでも揃う)。
  // 戻り値: true = 着地して続ける / false = 止まった
  const amendTask = (task, attempt) => {
    if (amended.has(task) || amendCount(ctx.root, task) >= 2) { queue.unshift(task); stop({ reason: "amend_repeated" }, task, attempt); return false; }
    amended.add(task);
    const planned = runAmend(ctx, task);
    log(task, `amend: ${planned.action}${planned.reason ? " " + planned.reason : ""}`);
    if (planned.action !== "continue") { queue.unshift(task); stop(planned, task, attempt); return false; }
    // 範囲指定の時は、次の一手が指す T(元の T・置き換え先・amend が足した是正タスクのどれか。amendOutcome が未着手と
    // 確認済み)をキューの先頭に置く。次の一手から回す時は次の周回でそのまま読む
    if (!fromHandoff) queue = settleQueue([nextStep(ctx.root).arg, ...queue]);
    return true;
  };

  // T を送り、予算停止なら再送、穴の記録なら /amend を挟む。戻り値: true = 続ける / false = 止まった
  const runTaskAttempts = (task) => {
    for (let attempt = 1; ; attempt += 1) {
      const outcome = runTask(ctx, task, attempt, { amended: amended.has(task) || amendCount(ctx.root, task) >= 2 });
      log(task, `${outcome.action}: ${outcome.reason}`);
      if (outcome.action === "next") { done.push(task); return true; }
      if (outcome.action === "skip") { skipped.push(task); return true; }
      if (outcome.action === "retry") continue;
      if (outcome.action === "amend") return amendTask(task, attempt);
      queue.unshift(task);
      stop(outcome, task, attempt);
      return false;
    }
  };

  // 同じ設計書の /breakdown が、間に T の完了を挟まずに続いたら止まる(着地したのに次の一手が /breakdown のまま)
  const breakdown = (design) => {
    if (lastBreakdown?.design === design && lastBreakdown.done === done.length) { stop({ reason: "breakdown_repeated", details: { design } }, null, null); return false; }
    lastBreakdown = { design, done: done.length };
    const outcome = runBreakdown(ctx, design);
    log("breakdown", `${outcome.action}: ${outcome.reason ?? design}`);
    if (outcome.action !== "continue") { stop(outcome, null, null); return false; }
    return true;
  };

  const intervalFull = () => (completedSinceCheckpoint(ctx.root)?.count ?? 0) >= CHECKPOINT_LIMIT;
  for (;;) {
    const work = fromHandoff ? loopStep(ctx.root) : { step: queue.length > 0 ? { command: "execute-task", arg: queue[0] } : null };
    if (!work.step && (!fromHandoff || openTasks(ctx.root).length === 0)) break;
    if (work.error || !work.step) { stop({ reason: work.error === "not_open" ? "next_step_not_open" : "next_step_not_runnable" }, work.step?.arg ?? null, null); return; }
    const { command, arg } = work.step;
    const task = command === "execute-task" || command === "amend" ? arg : null;
    if (command === "follow-up" || intervalFull()) { closeInterval(task); return; }
    if (!fromHandoff) queue.shift();
    const going = command === "breakdown" ? breakdown(arg) : command === "amend" ? amendTask(task, null) : runTaskAttempts(task);
    if (!going) return;
  }
  // 5 件目の完了で回す作業が尽きた時も区間を閉じる(閉じずに終えると、次の起動は回す作業が無く /follow-up を送れない)
  if (intervalFull()) { closeInterval(null); return; }
  finish({ stopped: false, reason: "all_done", ...base(), tasks_remaining: [], next_step: nextStep(ctx.root) }, 0);
}

main();
