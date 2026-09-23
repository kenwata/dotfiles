// コンテキスト予算の計算: 使用量の読み取り(Claude は statusline のサイドファイル、Codex は rollout の末尾)、
// 段の判定、エージェントへ差し込む文。判定と文面の正はここ。hook(../../context-budget.mjs)が呼ぶ。

import fs from "node:fs";
import { readStatusline } from "./session-state.mjs";

const TAIL_BYTES = [256 * 1024, 4 * 1024 * 1024];

// Claude: statusline が受け取る context_window(最後の API 応答の使用量)。current_usage の 3 項目の和が
// auto compact の判定と同じ物差し。無ければ used_percentage から戻す。窓の大きさが分からなければ null
export function readClaudeUsage(sessionId) {
  const side = readStatusline(sessionId);
  const window = Number(side?.context_window_size);
  if (!side || !(window > 0)) return null;
  const usage = side.current_usage;
  let tokens = null;
  if (usage && typeof usage === "object") {
    tokens = ["input_tokens", "cache_creation_input_tokens", "cache_read_input_tokens"].reduce((sum, key) => sum + (Number(usage[key]) || 0), 0);
  }
  if (!(tokens > 0) && Number.isFinite(Number(side.used_percentage))) tokens = (Number(side.used_percentage) / 100) * window;
  if (!(tokens >= 0)) return null;
  return { tokens, window, source: "statusline" };
}

// ファイルの末尾 bytes 分を読む(rollout は 1 セッションで数 MB になり、ツール呼び出しごとに全文は読めない)
function readTail(file, bytes) {
  const fd = fs.openSync(file, "r");
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    fs.readSync(fd, buffer, 0, buffer.length, start);
    return { text: buffer.toString("utf8"), whole: start === 0 };
  } finally {
    fs.closeSync(fd);
  }
}

// Codex: rollout(transcript_path)の最後の token_count。読み方は runner の readRollout(../codex-worker/core.mjs)と同じ
// last_token_usage.total_tokens / model_context_window
export function readCodexUsage(transcriptPath) {
  if (!transcriptPath) return null;
  for (const bytes of TAIL_BYTES) {
    let tail;
    try { tail = readTail(transcriptPath, bytes); } catch { return null; }
    const lines = tail.text.split("\n");
    if (!tail.whole) lines.shift(); // 途中から読んだ最初の行は壊れている
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i].includes("token_count")) continue;
      let event;
      try { event = JSON.parse(lines[i]); } catch { continue; }
      const info = event.type === "event_msg" && event.payload?.type === "token_count" ? event.payload.info : null;
      const tokens = Number(info?.last_token_usage?.total_tokens);
      const window = Number(info?.model_context_window);
      if (tokens >= 0 && window > 0) return { tokens, window, source: "rollout" };
    }
    if (tail.whole) return null;
  }
  return null;
}

// 直前のツール出力は、使用量の記録(次の API 応答で初めて反映される)にまだ乗っていないので概算で足す
export function toolResponseTokens(toolResponse) {
  if (toolResponse === undefined || toolResponse === null) return 0;
  const text = typeof toolResponse === "string" ? toolResponse : JSON.stringify(toolResponse);
  return Math.ceil(text.length / 4);
}

export function usagePercent(usage, extraTokens = 0) {
  return Math.round(((usage.tokens + extraTokens) / usage.window) * 1000) / 10;
}

export function stageOf(pct, { stage1, stage2 }) {
  if (pct >= stage2) return 2;
  if (pct >= stage1) return 1;
  return 0;
}

// 二段目の後も作業が続き、使用率がこれだけ伸びたら二段目の文をもう一度差し込む
export const RENOTICE_STEP = 5;

const NOTE = "node ~/.claude/hooks/lib/codex-worker/cli.mjs note";

export function budgetMessage(stage, { pct, threshold, root, task }) {
  if (stage === 1) {
    return (
      `[context-budget 1/2] コンテキスト使用率 ${pct}%(閾値 ${threshold}%)。新しいステップ(Codex worker の起動、次の実装単位)を始めない。` +
      `今のステップを閉じる: 受け入れか差し戻しを決め、結論を ${NOTE} --root ${root} --task ${task} --kind <fact|decision|rejected|intent> --step <番号> --text "<1 行>" で記録する。` +
      "完了条件をすべて満たしているなら、手順 6 の着地(TODO.md を [x]、コミット)まで進んでよい。"
    );
  }
  return (
    `[context-budget 2/2] コンテキスト使用率 ${pct}%(閾値 ${threshold}%)。compact(自動要約)が近い。今すぐ次の順で締めてターンを終える: ` +
    `(1) ${NOTE} --root ${root} --task ${task} --kind handoff --step <番号> --text "<中断点 / 途中成果物のパス / 棄却済みの経路と理由 / 次の一手>" ` +
    `(2) HANDOFF.md の仕掛かり中を同じ内容で更新し、次セッションの最初の一手を /execute-task ${task} にする ` +
    "(3) TODO.md を [x] にせず、コミットしない (4) 問いかけで終えずにターンを終える。再開は次のセッションの /execute-task が作業記録から行う。"
  );
}

export const STOP_REASON =
  "コンテキスト予算の二段目に達していますが、作業記録に handoff がありません。" +
  `終える前に ${NOTE} --root <ルート> --task <T> --kind handoff --step <番号> --text "<中断点 / 途中成果物のパス / 棄却済みの経路と理由 / 次の一手>" を書き、` +
  "HANDOFF.md の仕掛かり中を同じ内容で更新してからターンを終えること(TODO.md は [x] にせず、コミットしない。問いかけで終えない)。";
