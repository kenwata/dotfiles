// herdr(このマシンで Claude Code / Codex のペインを管理する terminal workspace manager)の CLI の薄い包み。
// 連続実行ループはこれだけを通して、対話セッションへのプロンプト送信と状態の観測を行う。
// 出力の形(herdr 0.9.1 で確認): 成功は {"id", "result": {"agent": {...}}} を stdout に出して exit 0、
// 失敗は {"error": {"code", "message"}, "id"} を出して exit 1。agent read は端末の文字をそのまま出す。
// 失敗の code: agent_blocked(承認・質問の画面で止まっている)/ agent_prompt_stalled(送信後 5 秒以内に
// working も blocked も観測されない)/ timeout / agent_not_found など。
// agent_status: idle / done(どちらも入力受付可)/ working / blocked / unknown。--wait はターンではなく状態を追う。

import { spawnSync } from "node:child_process";

export class HerdrError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

function call(args, timeoutMs) {
  const bin = process.env.HERDR_BIN || "herdr";
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: timeoutMs ? timeoutMs + 15_000 : undefined, // herdr 自身の --timeout より後に切る保険
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new HerdrError("spawn_failed", result.error.message);
  let json = null;
  try { json = JSON.parse(result.stdout); } catch { /* read は素のテキスト */ }
  if (json?.error) throw new HerdrError(json.error.code ?? "unknown_error", json.error.message ?? "");
  if (result.status !== 0) throw new HerdrError("exit_" + result.status, (result.stderr || result.stdout || "").trim());
  return { json, text: result.stdout };
}

export function available() {
  if (process.env.HERDR_ENV !== "1") return false;
  try { call(["--version"]); return true; } catch { return false; }
}

// { agent, agent_status, agent_session: { value }, cwd, pane_id, ... }
export function agentGet(target) {
  const agent = call(["agent", "get", target]).json?.result?.agent;
  if (!agent) throw new HerdrError("no_agent", `agent get ${target} に agent が無い`);
  return agent;
}

// wait が真なら、送信後の最初の落ち着いた状態(idle / done / blocked)まで待ち、その時の agent を返す
export function agentPrompt(target, text, { wait = false, timeoutMs } = {}) {
  const args = ["agent", "prompt", target, text];
  if (wait) args.push("--wait");
  if (timeoutMs) args.push("--timeout", String(timeoutMs));
  return call(args, wait ? timeoutMs : 30_000).json?.result?.agent ?? null;
}

export function agentWait(target, { until = [], timeoutMs } = {}) {
  const args = ["agent", "wait", target];
  for (const status of until) args.push("--until", status);
  if (timeoutMs) args.push("--timeout", String(timeoutMs));
  return call(args, timeoutMs).json?.result?.agent ?? null;
}

// 停止の報告に添える画面の末尾。読めなければ空文字
export function agentRead(target, lines = 80) {
  try { return call(["agent", "read", target, "--source", "recent-unwrapped", "--lines", String(lines)]).text; } catch { return ""; }
}
