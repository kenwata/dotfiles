// settle の1周分の判定を行うモジュール。
// 時刻は全て引数 now から取り、現在時刻関数は使わない。now は同期の待ちに費やした時間を除いた
// 呼び出し側の時計を表す。state は周をまたぐ計数だけを持つ素のデータとし、引数を書き換えず
// 次の state を返す。戻り値は完了 { done: true, state }、停止 { stop, detail, state }、
// または次周へ進む { wait: true, state } のいずれか。呼び出し側は wait の有無で次周へ進むか
// 判定へ進むかを分ける。猶予満了時に失敗理由が無ければ stop と detail は undefined になる。

import { activeWorkerLock } from "../../check-task-scope.mjs";
import { agentGet } from "./herdr.mjs";
import { readTurn } from "./session-state.mjs";
import { waitPhase } from "./turn.mjs";

/** @typedef {{ target: string }} ObserveContext */
/**
 * @typedef {object} SettleState
 * @property {number} limit 以前の答え待ち時間を加味した制限時刻
 * @property {number | null} quietSince 現在の静かな時間の開始時刻
 * @property {number | null} quietPausedAt no_evidence で静かな時間を止めた時刻
 * @property {number | null} answerSince 現在の答え待ちの開始時刻
 * @property {number | null} answeredFrom 前の答え待ち周の開始時刻
 * @property {number | null} blindSince 現在の no_evidence の開始時刻
 * @property {boolean} blind herdr の状態を読めないか
 * @property {boolean} completeSeen ターン中に完了を記録したか
 * @property {number} answerWaitMs 答え待ち時間の累計
 */
/**
 * @typedef {object} SettleContext
 * @property {string} target 状態を読む herdr target
 * @property {string} root worker lock を調べるプロジェクトのルート
 * @property {number} settleMs 必要な静かな時間
 * @property {number} answerTimeoutMs 答え待ちの上限時間
 * @property {string | null} session hook の記録を読む session
 * @property {() => boolean} isComplete 成果物が揃ったかを返す関数
 * @property {(text: string) => void} log 進行状況を記録する関数
 */
/**
 * @typedef {
 *   | { done: true, state: SettleState }
 *   | { stop: string | undefined, detail: string | undefined, state: SettleState }
 *   | { wait: true, state: SettleState }
 * } SettleResult
 * 戻り値に wait があれば次周へ進み、wait が無ければ完了・停止の判定へ進む。猶予満了時に
 * herdr が失敗も unknown も返さず agent_status を欠く場合、stop と detail は undefined。
 */

// 判定できない状態が続いた時に停止するまでの猶予。
// 画面の描き直しや一時的な失敗を許容する。
const HERDR_GRACE_MS = Number(process.env.TASK_LOOP_HERDR_GRACE_MS) > 0
  ? Number(process.env.TASK_LOOP_HERDR_GRACE_MS)
  : 60_000;

/**
 * herdr の agent_status と session_id を読む。unknown(分類できない)と失敗は
 * status を null にし、failure に止まる時の理由を入れる。
 * session_id は SessionStart の hook(herdr-agent-state.sh)が herdr に届けた値
 * @param {ObserveContext} ctx 状態を読む target
 * @returns {{ status: string | null, session?: string | null, failure?: string, detail?: string }}
 *   読み取った状態と、状態を読めなかった場合の理由
 */
export function observe(ctx) {
  try {
    const agent = agentGet(ctx.target);
    const session = agent.agent_session?.value ?? null;
    return agent.agent_status === "unknown"
      ? { status: null, session, failure: "unknown" }
      : { status: agent.agent_status, session };
  } catch (error) {
    return { status: null, failure: "herdr_error", detail: error.message };
  }
}

/**
 * 周をまたいで使う判定状態を作る。
 * @param {number} deadline 判定に使う制限時刻(ミリ秒)
 * @returns {SettleState} 各周で引き継ぐ初期状態
 */
export function initialSettleState(deadline) {
  return {
    limit: deadline,
    quietSince: null,
    quietPausedAt: null,
    answerSince: null,
    answeredFrom: null,
    blindSince: null,
    blind: false,
    completeSeen: false,
    answerWaitMs: 0,
  };
}

/**
 * 送った後、成果物の判定に進んでよいところまで、1 周ごとに見直して待つ。待ち方は hook(../../loop-turn.mjs)が
 * turns/<session>.json に書いたターンの状態を先に見て、herdr の agent_status は待つ方向の証拠を足すだけにする
 * (turn.mjs の waitPhase)。herdr の長い待ち(agent wait)は使わない(herdr.mjs 冒頭の経緯)。
 * - 答え待ち(AskUserQuestion・承認の画面): 人の答えを待ち、その間は作業の制限時間に数えない。制限時間はエージェントの
 *   停滞を見るためのもので、人の応答の遅さは別物だから。代わりに答え待ちが --answer-timeout-hours 続いたら止まる
 *   (中断で取り残された記録や herdr の読み違いで、無期限に待たないため)。窓の題名が <計画> T<n> / amend /
 *   breakdown のまま残り、何を待たれているかは見える
 * - ターンの途中(hook の running・herdr の working)、ターンが終わっても裏の処理が走っている(hook の stopped に
 *   background。完了通知で再開するまでの空白。turn.mjs の経緯)、Codex worker の実行中(ロック): 待つ
 * - 判定できない(hook が待つ理由を示さず herdr も読めない): 静かな時間を数えずに待ち、HERDR_GRACE_MS 続いたら止まる
 * - それ以外: 落ち着いた状態が settle の間続いたら落ち着いたとみなす(worker の完了通知で監督のターンが再開する間を空ける)
 * 成果物の完了は毎周見て、揃えばターンの終わりを待って先へ進む。herdr が読めない間も、hook がターンの終わりを
 * 書いていれば進む。
 * @param {SettleContext} ctx target・root・settleMs・answerTimeoutMs と session・isComplete・log を持つ判定入力
 * @param {SettleState} state 周をまたぐ計数状態。変更せず次の状態を返す
 * @param {number} now 同期の待ち時間を除いた現在時刻(ミリ秒)
 * @returns {SettleResult} wait があれば次周へ進み、無ければ呼び出し側は完了・停止の判定へ進む。
 *   猶予満了時に herdr が agent_status を欠き失敗理由も無い場合、stop と detail は undefined。
 */
export function settleTick(ctx, state, now) {
  const next = { ...state };
  let previousAnswerElapsed = 0;
  if (next.answeredFrom !== null) {
    previousAnswerElapsed = now - next.answeredFrom;
    next.limit += previousAnswerElapsed;
    next.answeredFrom = null;
  }
  if (now > next.limit) return { stop: "timeout", detail: undefined, state: next };

  const seen = observe(ctx);
  // 送った時と別のセッションになったら、hook の記録(前のセッションのもの)では待つ理由を決められない。判定へ進む
  // (runTask では judge が session_changed として止め、/follow-up・/amend・/breakdown では着地していないとして止まる)
  if (ctx.session && seen.session && seen.session !== ctx.session) {
    return { done: true, state: next };
  }
  if (Boolean(seen.failure) !== next.blind) {
    next.blind = !next.blind;
    const failure = seen.detail ?? seen.failure;
    const blindMessage = next.blind
      ? "herdr: 状態を読めない(" + failure + ")。hook の記録で判定を続ける"
      : "herdr: 状態を読めるようになった";
    ctx.log(blindMessage);
  }
  const phase = waitPhase(seen.status, ctx.session ? readTurn(ctx.session) : null, now);
  const turnGoing = phase === "busy" || phase === "awaiting_user" || activeWorkerLock(ctx.root);

  // 成果物が揃っても、ターンが続いている間(作業中・答え待ち・worker の実行中)は先へ進まない。次の /clear が
  // Claude Code の待ち行列に入り、ターンの終わりまで実行されないため(2026-09-24 の VC_Analysis T61: コミットの後に
  // 完了条件の確かめを 2 分続けている間に /clear を送り、clear_not_detected で止まった)。揃った後は静かな時間を待たない
  if (ctx.isComplete()) {
    if (!turnGoing) {
      if (next.answerSince !== null) ctx.log("blocked: 答えを受けて再開");
      return { done: true, state: next };
    }
    if (!next.completeSeen) {
      ctx.log("完了を確認。ターンが終わるのを待つ");
      next.completeSeen = true;
    }
  }
  if (phase !== "awaiting_user" && next.answerSince !== null) {
    ctx.log("blocked: 答えを受けて再開");
    next.answerSince = null;
  }
  if (phase !== "no_evidence") next.blindSince = null;
  if (phase === "awaiting_user") {
    if (next.answerSince === null) ctx.log("blocked: 利用者の答えを待つ");
    next.answerSince ??= now;
    next.answerWaitMs += previousAnswerElapsed;
    if (now - next.answerSince > ctx.answerTimeoutMs) {
      return { stop: "answer_timeout", detail: undefined, state: next };
    }
    next.quietSince = null;
    next.quietPausedAt = null;
    next.answeredFrom = now;
    return { wait: true, state: next };
  }
  // worker のロックは herdr によらない待つ理由なので、判定できない場合より先に見る
  if (phase === "busy" || activeWorkerLock(ctx.root)) {
    next.quietSince = null;
    next.quietPausedAt = null;
    return { wait: true, state: next };
  }
  if (phase === "no_evidence") {
    next.blindSince ??= now;
    if (now - next.blindSince > HERDR_GRACE_MS) {
      return { stop: seen.failure, detail: seen.detail, state: next };
    }
    if (next.quietSince !== null) next.quietPausedAt ??= now;
    return { wait: true, state: next };
  }
  if (next.quietPausedAt !== null) {
    next.quietSince += now - next.quietPausedAt;
    next.quietPausedAt = null;
  }
  next.quietSince ??= now;
  if (now - next.quietSince >= ctx.settleMs) return { done: true, state: next };
  return { wait: true, state: next };
}
