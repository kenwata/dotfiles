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

// T が属する計画の slug。/breakdown は計画ごとに `## #<n> <slug>` の節を作り、その T の行を節の中に置く。archive は
// `## Rotated <日付>` の下に `### #<n> <slug>` を置く(growing-docs.md の移動の手順)ので、深さ 2〜3 の見出しを読む。
// T の行の直前にある見出しが計画の見出しでなければ(`## §0 …`・`### 計画` など)、または T が無ければ null
export function planSlug(root, task) {
  for (const rel of ["TODO.md", ...ARCHIVES]) {
    let slug = null;
    for (const line of (readText(path.join(root, rel)) ?? "").split(/\r?\n/)) {
      if (/^###? /.test(line)) { slug = /^###? #\d+\s+(\S+)/.exec(line)?.[1] ?? null; continue; }
      if (/^\|/.test(line) && line.split("|").some((cell) => cell.trim() === task)) return slug;
    }
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

// head 以後の first-parent のコミットに、要約が T を境界付きで含むものがあるか。amend のコミットは除く
// (要約 `amend: <slug> の設計を改訂(T<n> 由来)` が由来の T に一致するが、T の実装ではない。completedSinceCheckpoint と同じ扱い)
export function committedSince(root, head, task) {
  let subjects;
  try { subjects = git(root, ["log", "--first-parent", "--format=%s", head ? `${head}..HEAD` : "HEAD"]); } catch { return false; }
  return subjects.split("\n").some((s) => !/^amend\b/.test(s) && taskPattern(task).test(s));
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

// HANDOFF.md から、エージェントが T をどこへ回したかを読む。穴(/amend T<n>)と /elaborate は「次セッションの最初の一手」節
// だけで見る(本文全体を見ると、「最後に完了したタスク」に残る `/amend T54`: … のような済んだ工程の記録に当たる。
// 2026-09-24 VC_Analysis の HANDOFF.md で実例)。関門の問いは「要確認」節に書かれるので本文全体で見る
export function handoffSignals(root, task) {
  const text = readText(path.join(root, "HANDOFF.md")) ?? "";
  const step = nextStep(root);
  return {
    amend: step?.command === "amend" && step.arg === task,
    elaborate: step?.command === "elaborate",
    gateQuestion: new RegExp(`\\[回収: ${task}(?![0-9]) 着手前\\]`).test(text),
  };
}

// HANDOFF.md の「## 次セッションの最初の一手」節の最初の行に書かれた工程のコマンド。{ command, arg } か、節もコマンドも
// 無ければ null。実際の書き方は `` - `/execute-task T59`(説明…) `` のように説明が続き、同じ行の後ろや次の行に後の工程
// (`/breakdown …` の再実行など。breakdown.md 手順 3)を書き添えることがあるので、最初の行の最初のコマンドだけを取る。
// 引数は英数字と . / _ - だけを取り、後ろに続く日本語や句点は含めない(`/execute-task T12で再開` → T12)
const STEP_COMMANDS = ["execute-task", "amend", "breakdown", "elaborate", "follow-up"];
export function nextStep(root) {
  const text = readText(path.join(root, "HANDOFF.md")) ?? "";
  const section = /^## 次セッションの最初の一手[^\n]*\n([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(text)?.[1];
  const line = section?.split("\n").find((l) => l.trim() !== "");
  if (!line) return null;
  const match = new RegExp(`(?:^|[^\\w/$.])[/$](${STEP_COMMANDS.join("|")})(?![\\w-])(?:[ \\t\\u3000]+([\\w./-]+))?`).exec(line);
  return match ? { command: match[1], arg: match[2]?.replace(/\.+$/, "") || null } : null;
}

// 次の一手が /breakdown なら、その設計書の相対パス。無ければ null
export function breakdownTarget(root) {
  const step = nextStep(root);
  return step?.command === "breakdown" && /^docs\/design\/\S+\.md$/.test(step.arg ?? "") ? step.arg : null;
}

// T を由来にした設計の改訂(要約 `amend: … (T<n> 由来)`)の件数。履歴全体から数えるので、ループを打ち直しても揃う。
// 穴の記録の取り下げ・/elaborate への回送(amend.md 手順 2)は「由来」を書かないので数えない
export function amendCount(root, task) {
  let subjects;
  try { subjects = git(root, ["log", "--first-parent", "--format=%s"]); } catch { return 0; }
  const origin = new RegExp(`${task}(?![0-9])\\s*由来`);
  return subjects.split("\n").filter((s) => /^amend\b/.test(s) && origin.test(s)).length;
}

// 計画工程(/amend・/breakdown)が書くファイル。これらに未コミットが残れば、その工程は着地していない。
// 作業ツリー全体を見ないのは、穴で止まった /execute-task の途中成果物(docs/ 配下の成果物の文書を含む)が
// 未コミットで残りうるため(execute-task.md 手順 4 の ④)
const PLANNING_PATHS = (p) => p === "HANDOFF.md" || p === "TODO.md" || p === "docs/decisions.md" || p.startsWith("docs/design/");

// /amend T<n> の後の判定。成果物(コミット・HANDOFF.md・計画工程のファイル)だけで決める
//   done       : HEAD が進み、計画工程のファイルに未コミットが無く、次の一手が未着手([ ])の T の /execute-task に
//                なった。戻る先は元の T に限らない(置き換え先・次の未着手・amend が足した是正タスク。amend.md 手順 6。
//                2026-09-24 VC_Analysis の amend T54 は是正タスク T59 を足して次の一手を T59 にした)
//   elaborate  : 次の一手が /elaborate(amend の段の判定で部分改訂の範囲を超えた)
//   incomplete : それ以外(承認されなかった・途中で止まった)
export function amendOutcome(root, headBefore) {
  const step = nextStep(root);
  if (step?.command === "elaborate") return "elaborate";
  const moved = headOf(root) !== headBefore;
  const landed = !dirtyPaths(root).some(PLANNING_PATHS);
  const back = step?.command === "execute-task" && /^T\d+$/.test(step.arg ?? "") && findTask(root, step.arg)?.state === " ";
  return moved && landed && back ? "done" : "incomplete";
}

// /breakdown の後の判定。done: HEAD が進み、計画工程のファイルに未コミットが無く、openBefore に無い [ ] の T が増えた /
// elaborate: 次の一手が /elaborate(設計書の不足で差し戻した)/ incomplete: それ以外
export function breakdownOutcome(root, headBefore, openBefore) {
  if (nextStep(root)?.command === "elaborate") return "elaborate";
  const moved = headOf(root) !== headBefore;
  const landed = !dirtyPaths(root).some(PLANNING_PATHS);
  const added = openTasks(root).some((t) => !openBefore.includes(t));
  return moved && landed && added ? "done" : "incomplete";
}

// /execute-task のターンが落ち着いた後の判定。action: next(次の T へ)/ retry(同じ T を新しいセッションで再送)/
// amend(/amend T<n> を送る。同じ T で 2 回目の穴なら止まる)/ stop
export function judge(f) {
  if (f.state === "x" && f.committed && f.dirty.length === 0) return { action: "next", reason: "completed" };
  if (f.sessionChanged) return { action: "stop", reason: "session_changed" };
  if (f.compacted) return { action: "stop", reason: "compacted" };
  if (f.state === "-") return { action: "stop", reason: "task_closed" };
  if (f.handoff.elaborate) return { action: "stop", reason: "hole_recorded" }; // /elaborate は対話で詰める工程なのでループに入れない
  if (f.handoff.amend) return f.amended ? { action: "stop", reason: "amend_repeated" } : { action: "amend", reason: "hole_recorded" };
  if (f.handoff.gateQuestion) return { action: "stop", reason: "gate_question" };
  if (f.state === "x") return { action: "stop", reason: f.committed ? "dirty_after_commit" : "not_committed" };
  if (f.budgetStage >= 1) {
    return f.retries >= f.retryMax
      ? { action: "stop", reason: "budget_retry_exhausted" }
      : { action: "retry", reason: "budget_stop" };
  }
  return { action: "stop", reason: "not_completed" };
}
