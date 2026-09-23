#!/usr/bin/env node
// PostToolUse + Stop + PostCompact + SessionStart hook: /execute-task の実行中、compact(コンテキストの自動要約)が
// 起きる前にエージェントを区切らせる予算停止
//
// 経緯(2026-09-23): 利用者はタスクの間で手動の /clear を打ち、compact による情報消失を避けてきた。Codex では
// タスクの量で compact が頻発している。compact が起きてから止めると、引き継ぎを書く時点で情報が既に失われて
// いる。そこで、閾値に達した時点(コンテキストが無傷のうち)で作業記録(worklog)と HANDOFF.md を書かせて
// ターンを終えさせ、次のセッションの /execute-task T<n> が同じ T を作業記録から再開する。
//
// 動作(/execute-task の実行中だけ。判定は check-task-scope.mjs がセッションごとに置く状態。通常の対話と
// サブエージェント(agent_id あり)には何もしない):
// - PostToolUse: 使用率 =(最後の使用量 + 今のツール出力の概算)÷ 窓。使用量の源は Claude が statusline の
//   サイドファイル(statusline.sh が書く)、Codex が rollout(transcript_path)の末尾。閾値(既定 Claude 70/80%・
//   Codex 60/70%、設定は ~/.config/claude-task-loop/config.json)を超えて段が上がった時だけ、一段目「新しい
//   ステップを始めない」・二段目「作業記録を確定してターンを終える」を additionalContext で差し込み、worklog に
//   kind=budget を残す。二段目の後も作業が続いて使用率が 5 ポイント伸びるたびに、二段目の文を差し込み直す
// - Stop: 二段目が立っているのに、その後の worklog に kind=handoff が無ければ 1 回だけ差し戻す
//   (stop_hook_active の再入は通す。T が [x] なら締め切ったので通す)
// - PostCompact / SessionStart(source=compact): compact を sessions/<id>.json と worklog に残す(ループはこれを見て止まる)。
//   SessionStart では 48 時間より古いセッションの状態を掃除する
// ホストは起動ラッパーの引数(claude / codex)で決める。無ければ turn_id の有無(Codex の入力だけが持つ)で決める。
//
// 既知の限界: ターンを強制終了する手段は無い。二段目で止まるのはエージェント自身で、Stop の差し戻しは「記録を
// 残さずに終える」事故を 1 回止めるだけ。Claude の使用量は最後に statusline が描画された時点の値なので、今の
// ツール出力の概算を足して遅れを埋める。statusline が動かない環境(claude -p など)では Claude 側は何もしない。
//
// 出力規約: 対象外・異常時は何も出さず exit 0(フェイルオープン)。PostToolUse の差し込みは
// hookSpecificOutput.additionalContext。Stop の差し戻しは stderr に理由を書いて exit 2(Claude と Codex で共通)。
// Codex の Stop は exit 0 の時に JSON を求めるので、Codex で通す時は {} を出す。

import fs from "node:fs";
import path from "node:path";
import { loadState, readTaskScope } from "./check-task-scope.mjs";
import { appendWorklog, readWorklog } from "./lib/codex-worker/worklog.mjs";
import {
  RENOTICE_STEP, STOP_REASON, budgetMessage, readClaudeUsage, readCodexUsage, stageOf, toolResponseTokens, usagePercent,
} from "./lib/task-loop/budget.mjs";
import { readSession, sweep, thresholds, updateSession } from "./lib/task-loop/session-state.mjs";

function hostOf(input) {
  const arg = process.argv[2];
  if (arg === "claude" || arg === "codex") return arg;
  return input.turn_id !== undefined ? "codex" : "claude";
}

const by = (input) => `hook:${String(input.session_id ?? "").slice(0, 8)}`;

function record(state, entry) {
  try { appendWorklog(state.root, state.task, entry); } catch { /* 記録のみ */ }
}

function handleToolUse(input, host) {
  const state = loadState(input);
  if (!state || !input.session_id) return;
  const usage = host === "codex" ? readCodexUsage(input.transcript_path) : readClaudeUsage(input.session_id);
  if (!usage) return;
  const pct = usagePercent(usage, toolResponseTokens(input.tool_response));
  const limits = thresholds(host);
  const stage = stageOf(pct, limits);
  const session = readSession(input.session_id);
  const previous = session.budget?.task === state.task && session.budget?.root === state.root ? session.budget : null;
  const prevStage = previous?.stage ?? 0;
  const now = Date.now();

  const renotice = stage === 2 && prevStage === 2 && pct >= (previous.notice_pct ?? pct) + RENOTICE_STEP;
  if (stage <= prevStage && !renotice) {
    if (previous) updateSession(input.session_id, { budget: { ...previous, pct, at: now } });
    return;
  }
  const budget = {
    task: state.task, root: state.root, stage, pct, window: usage.window, source: usage.source, at: now,
    stage1_at: previous?.stage1_at ?? now,
    stage2_at: stage === 2 ? (previous?.stage2_at ?? now) : null,
    notice_pct: pct,
  };
  updateSession(input.session_id, { host, budget });
  record(state, {
    kind: "budget", by: by(input), keys: { stage, pct, host, window: usage.window },
    text: stage === 2
      ? `二段目(閾値 ${limits.stage2}%)${renotice ? "の再通知" : ""}: 作業記録を確定してターンを終える指示を差し込んだ`
      : `一段目(閾値 ${limits.stage1}%): 新しいステップを始めない指示を差し込んだ`,
  });
  const message = budgetMessage(stage, { pct, threshold: stage === 2 ? limits.stage2 : limits.stage1, root: state.root, task: state.task });
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: message } }));
}

// 差し戻すなら true
function handleStop(input) {
  if (input.stop_hook_active === true) return false;
  const state = loadState(input);
  if (!state || !input.session_id) return false;
  const budget = readSession(input.session_id).budget;
  if (!budget || budget.stage < 2 || budget.task !== state.task || budget.root !== state.root) return false;
  try {
    const scope = readTaskScope(fs.readFileSync(path.join(state.root, "TODO.md"), "utf8"), state.task);
    if (scope?.state === "x") return false;
  } catch { /* TODO.md が読めなければ締めの確認だけを見る */ }
  const entries = readWorklog(state.root, state.task)?.entries ?? [];
  const since = Number(budget.stage2_at ?? 0) - 1000;
  if (entries.some((e) => e.kind === "handoff" && Date.parse(e.at) >= since)) return false;
  process.stderr.write(STOP_REASON);
  return true;
}

function handleCompact(input, trigger) {
  if (!input.session_id) return;
  updateSession(input.session_id, { compact: { at: Date.now(), trigger } });
  const state = loadState(input);
  if (state) record(state, { kind: "compact", by: by(input), keys: { trigger }, text: "compact が起きた。このセッションの文脈は要約後のもの" });
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return 0;
  }
  if (!input || typeof input !== "object" || input.agent_id) return 0;
  const host = hostOf(input);
  const event = input.hook_event_name;
  try {
    if (event === "PostToolUse") handleToolUse(input, host);
    else if (event === "Stop") {
      if (handleStop(input)) return 2;
      if (host === "codex") process.stdout.write("{}");
    } else if (event === "PostCompact") handleCompact(input, input.trigger ?? "auto");
    else if (event === "SessionStart") {
      // Claude は PostCompact で記録するので、SessionStart(source=compact)で二重に残さない
      if (input.source === "compact" && host === "codex") handleCompact(input, "codex");
      sweep();
    }
  } catch {
    return 0; // 予算停止の失敗で本来の作業を止めない
  }
  return 0;
}

// ラッパーからシンボリックリンク経由で起動されても本体と判定できるよう実体パスで比べる
let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url));
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) process.exitCode = main();
