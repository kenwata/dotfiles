// 連続実行ループ(cli.mjs)・予算停止の hook(../../context-budget.mjs)・statusline(~/.claude/statusline.sh)が
// 交わすセッションごとの状態と、閾値の設定。置き場は ${XDG_STATE_HOME:-~/.local/state}/claude-task-loop/。
// TMPDIR に置かないのは、ループのシェルと Claude / Codex のプロセスで TMPDIR が同じとは限らないため。
//
//   sessions/<session_id>.json   { session_id, host, loop, budget, compact, updated_at }
//     loop    … ループが /execute-task を送る前(Codex は送って session_id が変わった後。cli.mjs の openTurn)に書く
//               ({ target, task, root, attempt, started_at, loop_pid })。
//               check-stop-question.sh はこれがあるセッションを差し戻さない(無人の実行で問いかけは届かない)
//     budget  … hook が段を上げた時に書く({ task, root, stage, pct, window, source, at, stage1_at, stage2_at, notice_pct })
//     compact … hook が compact を検知した時に書く({ at, trigger })。ループはこれを見て止まる
//   statusline/<session_id>.json { session_id, at, used_percentage, context_window_size, current_usage, five_hour_pct }
//     statusline.sh が描画のたびに書く。Claude の使用率の源(hook の入力には使用率が無い)
//
// 閾値は ${XDG_CONFIG_HOME:-~/.config}/claude-task-loop/config.json(無ければ既定値)。動いているセッションに
// 環境変数は届かないので、恒常の設定はファイルだけで持つ。CONTEXT_BUDGET_STAGE1/2 は試験用の上書き。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SWEEP_AGE_MS = 48 * 60 * 60 * 1000;
// 既定の閾値の根拠(2026-09-23 の実測): Claude(1M 窓)は compact なしで 83% まで到達した例があり、1 ターンの
// 増加は p99.9 で 2.3%。Codex(258,400 窓)は直前の記録が 78% の時点で compact した例があり、1 ターンの増加は
// p99.9 で 11%。二段目は、記録を書く余裕を残して compact の手前に置く
export const DEFAULT_CONFIG = {
  claude: { stage1: 70, stage2: 80 },
  codex: { stage1: 60, stage2: 70 },
  retry_max: 2,
};

export function loopStateDir() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "claude-task-loop");
}

// check-task-scope.mjs の stateKey と同じ置換(ファイル名に使える文字だけにする)
export const sessionKey = (id) => String(id).replace(/[^A-Za-z0-9._-]/g, "_");

export function sessionFile(id) {
  return path.join(loopStateDir(), "sessions", `${sessionKey(id)}.json`);
}

export function statuslineFile(id) {
  return path.join(loopStateDir(), "statusline", `${sessionKey(id)}.json`);
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; }
}

// 途中まで書かれたファイルを読ませないよう、一時ファイルに書いてから置き換える
function writeJsonAtomic(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

export function readSession(id) {
  return (id && readJson(sessionFile(id))) || {};
}

// 最上位のキー単位で置き換える(null を渡したキーは消す)
export function updateSession(id, patch) {
  const current = readSession(id);
  const next = { ...current, session_id: id };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete next[key];
    else next[key] = value;
  }
  next.updated_at = Date.now();
  writeJsonAtomic(sessionFile(id), next);
  return next;
}

export function readStatusline(id) {
  return id ? readJson(statuslineFile(id)) : null;
}

// 48 時間より古いセッションの状態を消す(session_id はセッションごとに変わるので溜まり続けるため)
export function sweep(maxAgeMs = SWEEP_AGE_MS, now = Date.now()) {
  for (const dir of ["sessions", "statusline"].map((d) => path.join(loopStateDir(), d))) {
    let names;
    try { names = fs.readdirSync(dir); } catch { continue; }
    for (const name of names) {
      const file = path.join(dir, name);
      try {
        if (now - fs.statSync(file).mtimeMs > maxAgeMs) fs.rmSync(file, { force: true });
      } catch { /* 競合で消えた */ }
    }
  }
}

export function configFile() {
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config");
  return path.join(base, "claude-task-loop", "config.json");
}

export function readConfig() {
  const file = readJson(configFile()) ?? {};
  return {
    claude: { ...DEFAULT_CONFIG.claude, ...(file.claude ?? {}) },
    codex: { ...DEFAULT_CONFIG.codex, ...(file.codex ?? {}) },
    retry_max: Number(file.retry_max ?? DEFAULT_CONFIG.retry_max),
  };
}

// host の閾値。試験だけ環境変数で上書きできる
export function thresholds(host, config = readConfig()) {
  const base = config[host] ?? config.claude;
  const env1 = Number(process.env.CONTEXT_BUDGET_STAGE1);
  const env2 = Number(process.env.CONTEXT_BUDGET_STAGE2);
  return {
    stage1: Number.isFinite(env1) && env1 > 0 ? env1 : Number(base.stage1),
    stage2: Number.isFinite(env2) && env2 > 0 ? env2 : Number(base.stage2),
  };
}
