// 状態出力と作業記録の書き手、および run の作業場所を解決する。

import fs from "node:fs";
import path from "node:path";
import {
  formatStatusLines,
} from "./status.mjs";
import { appendWorklog, rootSlug, stateDir } from "./worklog.mjs";

export const STATUS_LOG_MAX = 1024 * 1024;

export function emit(report, runDir, code) {
  const text = JSON.stringify(report, null, 2);
  if (runDir) {
    try { fs.writeFileSync(path.join(runDir, "report.json"), text); } catch { /* stdout には出す */ }
  }
  process.stdout.write(text + "\n");
  process.exitCode = code;
}

// 状態行のプロジェクトごとのログ
export function statusLogPath(root) {
  return path.join(stateDir(), "status", `${rootSlug(root)}.log`);
}

// 状態行の前置きのステップ表記。計画があれば全体の何番目かを添える
export function stepLabel(plan, step) {
  const index = plan ? plan.steps.findIndex((s) => s.step === step) : -1;
  return index === -1 ? `s${step}` : `s${step} ${index + 1}/${plan.steps.length}`;
}

// 状態行の出力先。stderr(Claude Code のバックグラウンドタスクの表示・手で起動した端末)と、
// 別の端末から `tail -F` で追えるプロジェクトごとのログ。表示の失敗で run を止めない
export function statusWriter(root, task, label) {
  const logFile = statusLogPath(root);
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 }); } catch { /* 表示のみ */ }
  try {
    if (fs.statSync(logFile).size > STATUS_LOG_MAX) fs.truncateSync(logFile, 0);
  } catch { /* 初回 */ }
  const prefix = label ? `[Codex ${task} ${label}]` : `[Codex ${task}]`;
  return (text) => {
    if (!text) return;
    const out = formatStatusLines(prefix, text, new Date());
    try { process.stderr.write(out); } catch { /* 表示のみ */ }
    try { fs.appendFileSync(logFile, out); } catch { /* 表示のみ */ }
  };
}

// 作業記録への追記は run・verify・plan の成否を左右しない(書けなくても本来の出力は出す)
export function recordWorklog(root, task, entry) {
  try { appendWorklog(root, task, entry); } catch { /* 記録のみ */ }
}

// run の行の作業場所。帳簿の root で動いた run は null
export function runWorkspace(entry) {
  return entry.kind === "run" ? entry.keys.workspace ?? null : null;
}
