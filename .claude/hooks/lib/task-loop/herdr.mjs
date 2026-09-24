// herdr(このマシンで Claude Code / Codex のペインを管理する terminal workspace manager)の CLI の薄い包み。
// 連続実行ループはこれだけを通して、対話セッションへのプロンプト送信と状態の観測を行う。
// 出力の形(herdr 0.9.1 で確認): 成功は {"id", "result": {"agent": {...}}} を stdout に出して exit 0、
// 失敗は {"error": {"code", "message"}, "id"} を stderr に出して exit 1(2026-09-24 実測)。agent read は端末の文字をそのまま出す。
// 失敗の code: agent_blocked(送信の前に承認・質問の画面で止まっていた。何も送らない)/ agent_not_found など。
// agent_status: idle / done(どちらも入力受付可)/ working / blocked / unknown(エージェントはいるが分類できない。
// 完了を意味しない)。どれも herdr が画面を読んだ推測なので、ループは判定の主にしない(cli.mjs の settle・turn.mjs)。
// herdr の待ち(agent wait、agent prompt --wait)は使わない。経緯(2026-09-24): 10 分の agent wait の timeout を、
// stderr の JSON を読まずに exit_1 と取り違え、作業中の T106 の見張りを herdr_error で止めた

import { spawnSync } from "node:child_process";

export class HerdrError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`);
    this.code = code;
  }
}

// read は素のテキストなので、JSON として読めなければ null
function parseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

// timeoutMs は herdr 自身の --timeout。無い呼び出し(get・list など即答するもの)も、herdr が固まった時に
// ループが無期限に待たないよう CALL_TIMEOUT_MS で切る(切れたら spawn_failed)
const CALL_TIMEOUT_MS = 30_000;

function call(args, timeoutMs) {
  const bin = process.env.HERDR_BIN || "herdr";
  const result = spawnSync(bin, args, {
    encoding: "utf8",
    timeout: timeoutMs ? timeoutMs + 15_000 : CALL_TIMEOUT_MS, // herdr 自身の --timeout より後に切る保険
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error) throw new HerdrError("spawn_failed", result.error.message);
  const json = parseJson(result.stdout);
  const error = json?.error ?? parseJson(result.stderr)?.error;
  if (error) throw new HerdrError(error.code ?? "unknown_error", error.message ?? "");
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

// 送るだけで待たない。受理されたかは呼び出し側が hook の記録と画面の状態で確かめる(cli.mjs の openTurn)
export function agentPrompt(target, text) {
  return call(["agent", "prompt", target, text]).json?.result?.agent ?? null;
}

// 停止の報告に添える画面の末尾。読めなければ空文字
export function agentRead(target, lines = 80) {
  try { return call(["agent", "read", target, "--source", "recent-unwrapped", "--lines", String(lines)]).text; } catch { return ""; }
}

// ペインの端末の題名から装飾の記号を除いたもの。Claude は --name・/rename で付けたセッション名をここへ出す
export function paneTitle(pane) {
  return call(["pane", "get", pane]).json?.result?.pane?.terminal_title_stripped ?? null;
}

// このサーバーの全エージェント({ agent, agent_status, agent_session, cwd, foreground_cwd, pane_id, tab_id, ... })
export function agentList() {
  return call(["agent", "list"]).json?.result?.agents ?? [];
}

// 呼び出し元のペインの隣に、フォーカスを移さずにペインを作る(HERDR_PANE_ID の中から呼ぶ)。新しい pane_id を返す
export function paneSplit({ cwd, direction = "right" } = {}) {
  const args = ["pane", "split", "--current", "--direction", direction, "--no-focus"];
  if (cwd) args.push("--cwd", cwd);
  const pane = call(args).json?.result?.pane;
  if (!pane?.pane_id) throw new HerdrError("no_pane", "pane split の結果に pane_id が無い");
  return pane.pane_id;
}

// 既存のシェルのペインでエージェントを起動し、入力を受け付けるまで待つ。起動時に確認の画面で止まると
// agent_not_ready(HerdrError)になる
export function agentStart(name, { kind = "claude", pane, args = [], timeoutMs = 90_000 } = {}) {
  const argv = ["agent", "start", name, "--kind", kind, "--pane", pane, "--timeout", String(timeoutMs)];
  if (args.length > 0) argv.push("--", ...args);
  return call(argv, timeoutMs).json?.result?.agent ?? null;
}
