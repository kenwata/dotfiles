// 連続実行ループの判定。エージェントの自己申告ではなく、リポジトリの成果物(TODO.md の状態・コミット・
// 作業ツリー)と、hook が残した状態(予算停止・compact)だけで「次へ進む / 同じ T を再送 / 止まる」を決める。
// T の状態と依存の読み方の正は ../../check-task-scope.mjs の readTaskScope(execute-task と同じ TODO.md の書式)。

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { readTaskScope } from "../../check-task-scope.mjs";
import { trackedPaths } from "../codex-worker/core.mjs";

const ARCHIVES = [".claude/archive/TODO.md", ".codex/archive/TODO.md"];

// "T12..T16" / "T12,T13,T15" / 混在。書かれた順に並べ、重複は最初の 1 回だけ
export function parseTaskList(spec) {
  const tasks = [];
  const errors = [];
  for (const part of String(spec ?? "").split(",").map((p) => p.trim()).filter(Boolean)) {
    const range = /^T(\d+)\s*\.\.\s*T(\d+)$/.exec(part);
    const single = /^T(\d+)$/.exec(part);
    if (range) {
      const [from, to] = [Number(range[1]), Number(range[2])];
      if (from > to) { errors.push(`範囲が逆順: ${part}`); continue; }
      for (let n = from; n <= to; n += 1) tasks.push(`T${n}`);
    } else if (single) tasks.push(`T${single[1]}`);
    else errors.push(`T<n> / T<n>..T<m> ではない: ${part}`);
  }
  if (tasks.length === 0 && errors.length === 0) errors.push("--tasks が空");
  return { tasks: [...new Set(tasks)], errors };
}

function readText(file) {
  try { return fs.readFileSync(file, "utf8"); } catch { return null; }
}

// TODO.md のタスク表で [ ] の T を、書かれている順に返す(--tasks を省略した時の既定)。計画表の行は T の列が無いので入らない
export function openTasks(root) {
  const tasks = [];
  for (const line of (readText(path.join(root, "TODO.md")) ?? "").split(/\r?\n/)) {
    if (!/^\|/.test(line)) continue;
    const cells = line.split("|").map((c) => c.trim());
    const id = cells.find((c) => /^T\d+$/.test(c));
    if (id && cells.includes("[ ]") && !tasks.includes(id)) tasks.push(id);
  }
  return tasks;
}

// TODO.md、無ければ archive から T を探す(完了・廃止のタスクは archive へ逐語で移る)
export function findTask(root, task) {
  for (const rel of ["TODO.md", ...ARCHIVES]) {
    const text = readText(path.join(root, rel));
    const scope = text === null ? null : readTaskScope(text, task);
    if (scope) return { ...scope, source: rel };
  }
  return null;
}

// 依存がすべて締まっているか。[-] は置き換え先(→T<n>)で読み替え、置き換え先が無ければ締まっていない扱い
// (execute-task も同じ場合に推測せず止まる)。戻り値: 締まっていない依存の説明の配列
export function openDependencies(root, task) {
  const scope = findTask(root, task);
  if (!scope) return [`${task} が TODO.md にも archive にも無い`];
  const open = [];
  for (const dep of scope.deps ?? []) {
    let current = dep;
    const seen = new Set();
    for (;;) {
      const info = findTask(root, current);
      if (!info) { open.push(`${dep} が見つからない`); break; }
      if (info.state === "x") break;
      if (info.state === "-" && info.replacedBy && !seen.has(info.replacedBy)) {
        seen.add(current);
        current = info.replacedBy;
        continue;
      }
      open.push(info.state === "-" ? `${dep} は廃止で置き換え先が無い` : `${current} が未完了`);
      break;
    }
  }
  return open;
}

function git(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });
}

export function headOf(root) {
  try { return git(root, ["rev-parse", "HEAD"]).trim(); } catch { return null; }
}

const taskPattern = (task) => new RegExp(`(^|[^0-9A-Za-z])${task}([^0-9]|$)`);

// head 以後の first-parent のコミットに、要約が T を境界付きで含むものがあるか
export function committedSince(root, head, task) {
  let subjects;
  try { subjects = git(root, ["log", "--first-parent", "--format=%s", head ? `${head}..HEAD` : "HEAD"]); } catch { return false; }
  return subjects.split("\n").some((s) => taskPattern(task).test(s));
}

// head 以後の first-parent に、Follow-Up-Checkpoint: true の trailer を持つコミット(/follow-up の checkpoint)が増えたか
export function checkpointSince(root, head) {
  let log;
  try { log = git(root, ["log", "--first-parent", "--format=%H%x1f%(trailers:key=Follow-Up-Checkpoint,valueonly)%x1e", head ? `${head}..HEAD` : "HEAD"]); } catch { return false; }
  return log.split("\x1e").some((record) => (record.split("\x1f")[1] ?? "").trim().split("\n").includes("true"));
}

// 最新の Follow-Up-Checkpoint 以後に [x] になった異なる T の数(execute-task 手順1 の数え方。amend のコミットは数えない)。
// checkpoint が無ければ null(execute-task もこの制限だけでは止まらない)
export function completedSinceCheckpoint(root) {
  let log;
  try { log = git(root, ["log", "--first-parent", "--format=%H%x1f%s%x1f%(trailers:key=Follow-Up-Checkpoint,valueonly)%x1e"]); } catch { return null; }
  const tasks = new Set();
  for (const record of log.split("\x1e")) {
    const [sha, subject, trailer] = record.replace(/^\n/, "").split("\x1f");
    if (!sha) continue;
    if ((trailer ?? "").trim().split("\n").includes("true")) {
      const done = [...tasks].filter((t) => findTask(root, t)?.state === "x");
      return { checkpoint: sha, count: done.length, tasks: done };
    }
    if (/^amend\b/.test(subject ?? "")) continue;
    for (const [, n] of (subject ?? "").matchAll(/(?:^|[^0-9A-Za-z])T(\d+)(?=[^0-9]|$)/g)) tasks.add(`T${n}`);
  }
  return null;
}

// 未コミットの変更(.gitignore 対象を除く)
export function dirtyPaths(root) {
  return trackedPaths(root).filter((e) => !e.ignored).map((e) => e.path);
}

// HANDOFF.md から、エージェントが T をどこへ回したかを読む
export function handoffSignals(root, task) {
  const text = readText(path.join(root, "HANDOFF.md")) ?? "";
  const t = `${task}(?![0-9])`;
  return {
    amend: new RegExp(`[/$]amend\\s+${t}`).test(text),
    elaborate: /[/$]elaborate\s+docs\/design\//.test(text),
    gateQuestion: new RegExp(`\\[回収: ${t} 着手前\\]`).test(text),
  };
}

// /execute-task のターンが落ち着いた後の判定。action: next(次の T へ)/ retry(同じ T を新しいセッションで再送)/ stop
export function judge(f) {
  if (f.state === "x" && f.committed && f.dirty.length === 0) return { action: "next", reason: "completed" };
  if (f.sessionChanged) return { action: "stop", reason: "session_changed" };
  if (f.compacted) return { action: "stop", reason: "compacted" };
  if (f.state === "-") return { action: "stop", reason: "task_closed" };
  if (f.handoff.amend || f.handoff.elaborate) return { action: "stop", reason: "hole_recorded" };
  if (f.handoff.gateQuestion) return { action: "stop", reason: "gate_question" };
  if (f.state === "x") return { action: "stop", reason: f.committed ? "dirty_after_commit" : "not_committed" };
  if (f.budgetStage >= 1) {
    return f.retries >= f.retryMax
      ? { action: "stop", reason: "budget_retry_exhausted" }
      : { action: "retry", reason: "budget_stop" };
  }
  return { action: "stop", reason: "not_completed" };
}
