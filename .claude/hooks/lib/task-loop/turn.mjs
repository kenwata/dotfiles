// ループが駆動するセッションのターンの状態。hook(../../loop-turn.mjs)が書き、ループ(cli.mjs の送信の受理の確かめ
// waitAccepted と settle)が読む。
//
// 経緯(2026-09-24): ループは herdr の agent_status だけで「ターンが落ち着いたか」「問いの画面か」を見ていた。
// herdr は端末の画面を読んで判定し、どの規則にも当たらない画面を idle にする(default_known_agent_idle_fallback)。
// 名前を付けた Claude のセッションは問いの画面の案内文の下に `── <名前> ─` の罫線を描き、herdr の問いの画面の規則
// (live_blocked_form。最後の横罫線より下だけを見る)が当たらなくなる。VC_Analysis の /follow-up が問いを出した
// 約 94 秒後に、ループは idle が --settle-sec 続いたとみなして follow_up_incomplete で終えた(herdr 0.9.1、manifest
// 2026.09.11.1。止まった時の画面を `herdr agent explain --file` にかけて idle、最下行の罫線を除くと blocked を確認)。
// そこで、ターンの始まりと終わりと答え待ちを Claude Code の hook で記録し、画面の判定と併せて読む。
// 同日、作業中の T106 の見張りが herdr の agent wait の失敗を読み違えて止まったのを機に、hook の記録を判定の主にし、
// herdr の画面の判定は待つ方向の証拠を足すだけにした(利用者と合意。waitPhase の優先順)。

// hook の running がこれより古く、herdr も作業中を見ていなければ、中断(Esc)で取り残された記録とみなす。
// 中断で Stop が発火するかは公式の文書に書かれておらず、未確認。ターンの途中なら、ツールが終わるたびに
// PostToolUse が記録を新しくする。Bash ツールの上限 10 分に余裕を持たせた値
export const STALE_RUNNING_MS = 30 * 60_000;

// 状態の値域。running: ターンの途中 / awaiting_user: 問い・許可の確認で利用者の答えを待つ / stopped: ターンを終えた。
// stopped には、ターンを終えた時に走っていた裏の処理(run_in_background の Bash・サブエージェントなど)の数を
// background として添える(0 なら書かない)。裏の処理が終わると完了通知でターンが再開するので、その間は待つ。
// 経緯(2026-09-24): T106 ではターンの終わりから完了通知での再開までの空白が 97〜810 秒で 11 回あり、画面の判定だけでは
// 落ち着いたと取り違えうる(--settle-sec の既定 90 秒より長い)。Stop の hook の入力の background_tasks
// (Claude Code 2.1.281 で採取: [{ id, type: "shell", status: "running", description, command }])で埋める
export const TURN_STATE = Object.freeze({ running: "running", awaitingUser: "awaiting_user", stopped: "stopped" });

// 問いの画面を出すツール。PreToolUse のこれだけを答え待ちとして記録する
const QUESTION_TOOL = "AskUserQuestion";

const RUNNING_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "PostToolUseFailure"]);
const STOPPED_EVENTS = new Set(["Stop", "StopFailure"]);

/**
 * hook の入力から、記録するターンの状態を決める。
 * PreToolUse の AskUserQuestion は、品質ゲートの hook が拒否して画面が出ないこともある。その時も次のツールの
 * PostToolUse か Stop で上書きされるので、答え待ちが残り続けることはない。
 * @param {{ hook_event_name?: string, tool_name?: string, agent_id?: string, background_tasks?: unknown }} input hook の標準入力(JSON を読んだもの)
 * @param {number} now 記録する時刻(ミリ秒)
 * @returns {{ state: string, event: string, at: number, background?: number } | null} 記録する状態。サブエージェントの発火・扱わない event なら null
 */
export function turnFromHook(input, now) {
  const event = input.hook_event_name;
  if (input.agent_id || !event) return null;
  const at = (state) => ({ state, event, at: now });
  if (RUNNING_EVENTS.has(event)) return at(TURN_STATE.running);
  if (STOPPED_EVENTS.has(event)) {
    const background = Array.isArray(input.background_tasks) ? input.background_tasks.filter((t) => t?.status === "running").length : 0;
    return background > 0 ? { ...at(TURN_STATE.stopped), background } : at(TURN_STATE.stopped);
  }
  if (event === "PermissionRequest") return at(TURN_STATE.awaitingUser);
  if (event === "PreToolUse" && input.tool_name === QUESTION_TOOL) return at(TURN_STATE.awaitingUser);
  return null;
}

/**
 * ループの settle が今どう待つかを、hook が書いたターンの状態と herdr の agent_status から決める。
 * hook の記録を先に見て、herdr は「待つ」方向の証拠を足すだけにする(2026-09-24 利用者と合意。herdr は画面を
 * 読んだ推測で、名前の罫線の下の問いの画面を idle と見逃し、画面の判定を外すこともある)。優先順:
 *   1. hook の awaiting_user、または herdr の blocked → awaiting_user
 *   2. hook の running(STALE_RUNNING_MS 以内)、hook の stopped に裏の処理が残っている、または herdr の working → busy
 *   3. herdr の状態が取れない(失敗・unknown) → no_evidence(落ち着いたとはみなさない)
 *   4. それ以外 → quiet
 * herdr だけが blocked の時も答え待ちにするのは、サブエージェントの問い(agent_id 付きの発火は記録しない)・MCP の
 * elicitation・Claude Code 自身の確認画面を hook が記録しないため。これを作業時間に数えると、人の答えが数時間後に
 * なる無人運転で、答えの前に制限時間で止まる。誤った blocked で無期限に待つ危険は、呼び出し側の答え待ちの上限で区切る。
 * hook の awaiting_user は herdr の working より先に見る。許可の確認の後にツールが動く間も答え待ちに数えるが、
 * 待ち方は同じで、変わるのは時間の数え方だけ。逆に herdr の working を先にすると、herdr が問いの画面を作業中と
 * 読み違えた時に、人の答えを待つ時間を作業の制限時間に数えて止まる。
 * 中断で取り残された awaiting_user は問いの画面と区別できないので、答えを待ち続ける(誤って進むより安全なため)。
 * hook の記録が無いホスト(Codex)・環境では herdr だけで決まる。
 * @param {string | null} agentStatus herdr の agent_status(idle / done / working / blocked)。取れない・unknown なら null
 * 裏の処理が残る stopped は古さで打ち切らない(Codex worker の待機など長い処理があるため)。作業の制限時間で区切る。
 * @param {{ state: string, at: number, background?: number } | null | undefined} turn turns/<id>.json の内容
 * @param {number} now 今の時刻(ミリ秒)。running が STALE_RUNNING_MS より古いかを見る
 * @returns {"awaiting_user" | "busy" | "no_evidence" | "quiet"} awaiting_user: 利用者の答えを待つ(作業の制限時間に
 *   数えない)/ busy: ターンの途中なので待つ / no_evidence: 判定できないので静かな時間を数えずに待つ /
 *   quiet: 落ち着いた候補(静かな時間を数える)
 */
export function waitPhase(agentStatus, turn, now) {
  if (turn?.state === TURN_STATE.awaitingUser || agentStatus === "blocked") return "awaiting_user";
  if (turn?.state === TURN_STATE.running && now - turn.at < STALE_RUNNING_MS) return "busy";
  if (turn?.state === TURN_STATE.stopped && turn.background > 0) return "busy";
  if (agentStatus === "working") return "busy";
  if (agentStatus === null || agentStatus === undefined) return "no_evidence";
  return "quiet";
}
