// ループが駆動するセッションのターンの状態。hook(../../loop-turn.mjs)が書き、ループ(cli.mjs の settle)が読む。
//
// 経緯(2026-09-24): ループは herdr の agent_status だけで「ターンが落ち着いたか」「問いの画面か」を見ていた。
// herdr は端末の画面を読んで判定し、どの規則にも当たらない画面を idle にする(default_known_agent_idle_fallback)。
// 名前を付けた Claude のセッションは問いの画面の案内文の下に `── <名前> ─` の罫線を描き、herdr の問いの画面の規則
// (live_blocked_form。最後の横罫線より下だけを見る)が当たらなくなる。VC_Analysis の /follow-up が問いを出した
// 約 94 秒後に、ループは idle が --settle-sec 続いたとみなして follow_up_incomplete で終えた(herdr 0.9.1、manifest
// 2026.09.11.1。止まった時の画面を `herdr agent explain --file` にかけて idle、最下行の罫線を除くと blocked を確認)。
// そこで、ターンの始まりと終わりと答え待ちを Claude Code の hook で記録し、画面の判定と併せて読む。

// hook の running がこれより古く、herdr も作業中を見ていなければ、中断(Esc)で取り残された記録とみなす。
// 中断で Stop が発火するかは公式の文書に書かれておらず、未確認。ターンの途中なら、ツールが終わるたびに
// PostToolUse が記録を新しくする。Bash ツールの上限 10 分に余裕を持たせた値
export const STALE_RUNNING_MS = 30 * 60_000;

// 状態の値域。running: ターンの途中 / awaiting_user: 問い・許可の確認で利用者の答えを待つ / stopped: ターンを終えた
export const TURN_STATE = Object.freeze({ running: "running", awaitingUser: "awaiting_user", stopped: "stopped" });

// 問いの画面を出すツール。PreToolUse のこれだけを答え待ちとして記録する
const QUESTION_TOOL = "AskUserQuestion";

const RUNNING_EVENTS = new Set(["UserPromptSubmit", "PostToolUse", "PostToolUseFailure"]);
const STOPPED_EVENTS = new Set(["Stop", "StopFailure"]);

/**
 * hook の入力から、記録するターンの状態を決める。
 * PreToolUse の AskUserQuestion は、品質ゲートの hook が拒否して画面が出ないこともある。その時も次のツールの
 * PostToolUse か Stop で上書きされるので、答え待ちが残り続けることはない。
 * @param {{ hook_event_name?: string, tool_name?: string, agent_id?: string }} input hook の標準入力(JSON を読んだもの)
 * @param {number} now 記録する時刻(ミリ秒)
 * @returns {{ state: string, event: string, at: number } | null} 記録する状態。サブエージェントの発火・扱わない event なら null
 */
export function turnFromHook(input, now) {
  const event = input.hook_event_name;
  if (input.agent_id || !event) return null;
  const at = (state) => ({ state, event, at: now });
  if (RUNNING_EVENTS.has(event)) return at(TURN_STATE.running);
  if (STOPPED_EVENTS.has(event)) return at(TURN_STATE.stopped);
  if (event === "PermissionRequest") return at(TURN_STATE.awaitingUser);
  if (event === "PreToolUse" && input.tool_name === QUESTION_TOOL) return at(TURN_STATE.awaitingUser);
  return null;
}

/**
 * ループの settle が今どう待つかを、herdr の agent_status と hook が書いたターンの状態から決める。優先順は
 * herdr の blocked → herdr の working → hook の awaiting_user → hook の running → 落ち着いた候補。
 * herdr の blocked・working は画面に出た積極的な証拠なので先に見る(許可の確認の後にツールが動いている間、hook は
 * PostToolUse まで awaiting_user のままなので、herdr の working で作業中に倒す)。herdr が見逃す問いの画面と
 * 画面に出ない作業を hook で補う。hook の記録が無いホスト(Codex)・環境では従来どおり herdr だけで決める。
 * 中断で取り残された awaiting_user は問いの画面と区別できないので、答えを待ち続ける(誤って進むより安全なため)。
 * @param {string} agentStatus herdr の agent_status(idle / done / working / blocked。unknown は呼び出し側で扱う)
 * @param {{ state: string, at: number } | null | undefined} turn turns/<id>.json の内容
 * @param {number} now 今の時刻(ミリ秒)。running が STALE_RUNNING_MS より古いかを見る
 * @returns {"awaiting_user" | "busy" | "quiet"} awaiting_user: 利用者の答えを待つ(制限時間に数えない)/
 *   busy: ターンの途中なので待つ / quiet: 落ち着いた候補(静かな時間を数える)
 */
export function waitPhase(agentStatus, turn, now) {
  if (agentStatus === "blocked") return "awaiting_user";
  if (agentStatus === "working") return "busy";
  if (turn?.state === TURN_STATE.awaitingUser) return "awaiting_user";
  if (turn?.state === TURN_STATE.running && now - turn.at < STALE_RUNNING_MS) return "busy";
  return "quiet";
}
