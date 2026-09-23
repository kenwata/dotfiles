// Codex worker runner と /execute-task が共有する、タスク単位の置き場と作業記録(worklog)。
// cli.mjs はトップレベルで引数を解析して動き出すので import できない。置き場の関数と worklog の読み書きを
// hook(../../context-budget.mjs)やループ(../task-loop/)からも使えるよう、ここに分けて持つ。
//
// worklog は ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/tasks/<ルート名>/T<n>/worklog.md に置く。
// リポジトリの外なので作業ツリーを汚さず、check-task-scope の対象パスの判定にも掛からない。runs/ と違い
// 削除しないので、7 日を過ぎた後もタスクの再開の照合に使える。追記専用。1 行 1 件:
//   - <ISO8601> kind=<種別> [step=s<番号>] [by=<書き手>] [<キー>=<値> ...] — <人向けの本文 1 行>
// 値に空白・カンマ・% を入れる時は %XX で符号化する(一覧の値はカンマ区切り)。
// 経緯(2026-09-23): compact(コンテキストの自動要約)の前に作業を区切り、次のセッションが同じ T を再開できる
// ようにするため。Thinking の本文は transcript に残らないので、結論(確かめた事実・決めたことと理由・捨てた
// 仮説・次の意図)をステップの境目ごとに外へ出す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parsePlan } from "./core.mjs";

// 監督(Claude Code)または Codex ホスト本人が cli.mjs note で書く種別
export const NOTE_KINDS = ["fact", "decision", "rejected", "intent", "step", "handoff", "resume"];
// runner と hook が書く種別を含む全体
export const WORKLOG_KINDS = ["plan", "run", "verify", ...NOTE_KINDS, "budget", "compact"];
const LIST_KEYS = new Set(["changed", "baseline"]);

export function stateDir() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "claude-codex-worker");
}

export function runsDir() {
  return path.join(stateDir(), "runs");
}

// プロジェクトごとの置き場の名前。~/.claude/projects/ と同じく、ルートのパスの記号を - にしたもの
export const rootSlug = (root) => root.replace(/[^A-Za-z0-9]/g, "-");

// タスクのステップ計画・packet の写し・worklog の置き場。セッションの scratchpad と違い、場所がタスクで決まる
export function taskDir(root, task) {
  return path.join(stateDir(), "tasks", rootSlug(root), task);
}

export function readPlan(root, task) {
  const file = path.join(taskDir(root, task), "plan.md");
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  return { file, ...parsePlan(text) };
}

export function worklogPath(root, task) {
  return path.join(taskDir(root, task), "worklog.md");
}

// "1" と "s1" のどちらで渡されても s<番号> にそろえる
export function normalizeStep(step) {
  if (step === undefined || step === null || step === "") return null;
  const text = String(step);
  return text.startsWith("s") ? text : `s${text}`;
}

const encode = (text) => String(text).replace(/[%,\s]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
const decode = (text) => text.replace(/%([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)));

export function formatEntry({ at = new Date(), kind, step, by, keys = {}, text = "" }) {
  const parts = [`- ${new Date(at).toISOString()}`, `kind=${kind}`];
  const normalized = normalizeStep(step);
  if (normalized) parts.push(`step=${encode(normalized)}`);
  if (by) parts.push(`by=${encode(by)}`);
  for (const [key, value] of Object.entries(keys)) {
    if (value === undefined || value === null) continue;
    parts.push(`${key}=${Array.isArray(value) ? value.map(encode).join(",") : encode(value)}`);
  }
  const body = String(text).replace(/\s*\n\s*/g, " ").trim();
  return `${parts.join(" ")} — ${body}`;
}

// 解釈できない行は null(見出し・空行・手で書いた行を読み飛ばす)
export function parseEntry(line) {
  const match = /^- (\S+) ((?:[A-Za-z_]+=\S*\s+)+)— ?(.*)$/.exec(line);
  if (!match) return null;
  const entry = { at: match[1], kind: null, step: null, by: null, keys: {}, text: match[3] };
  for (const pair of match[2].trim().split(/\s+/)) {
    const index = pair.indexOf("=");
    const key = pair.slice(0, index);
    const raw = pair.slice(index + 1);
    if (key === "kind") entry.kind = raw;
    else if (key === "step") entry.step = decode(raw);
    else if (key === "by") entry.by = decode(raw);
    else entry.keys[key] = LIST_KEYS.has(key) ? (raw === "" ? [] : raw.split(",").map(decode)) : decode(raw);
  }
  return entry.kind ? entry : null;
}

export function appendWorklog(root, task, entry) {
  const file = worklogPath(root, task);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) fs.writeFileSync(file, `# ${task} worklog — ${root}\n\n`);
  const line = formatEntry(entry);
  fs.appendFileSync(file, line + "\n");
  return { file, line };
}

// 無ければ null
export function readWorklog(root, task) {
  const file = worklogPath(root, task);
  let text;
  try { text = fs.readFileSync(file, "utf8"); } catch { return null; }
  return { file, entries: text.split("\n").map(parseEntry).filter(Boolean) };
}
