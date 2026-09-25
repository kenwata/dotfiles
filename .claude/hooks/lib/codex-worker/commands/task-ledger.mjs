// T の計画・作業記録を読み書きするコマンド。

import fs from "node:fs";
import path from "node:path";
import {
  dirtyWorktree,
  gitRoot,
  hasNodeSystemErrorCode,
  hasProcessExitStatus,
  processErrorText,
} from "../git.mjs";
import { activeWorkerLock, ALWAYS_ALLOWED, isInside } from "../../../check-task-scope.mjs";
import { parsePlan } from "../core.mjs";
import { NOTE_KINDS, appendWorklog, normalizeStep, readPlan, readWorklog, runsDir, taskDir } from "../worklog.mjs";
import { emit, recordWorklog, runWorkspace, statusWriter } from "../output.mjs";
import { readWorktreeRecord, worktreeStatus } from "../worktree.mjs";

/** @typedef {{ kind: string, keys: { branch?: string, workspace?: string } }} WorkspaceRunEntry */
/**
 * @typedef {Object} WorklogEntry
 * @property {string} kind Entry kind.
 * @property {string | null} step Recorded step identifier.
 * @property {Record<string, string | undefined>} keys Recorded key-value data.
 */
/** @typedef {"defect" | "supervisor" | "spec" | "environment" | "unknown"} RerunKind */
/** @typedef {{ runs: number, seconds: number }} RunTotals */
/** @typedef {{ runs: number, seconds: number, share: number | null }} SupersededSummary */
/**
 * @typedef {Object} RerunSummary
 * @property {number} runs Repeated run count.
 * @property {number} seconds Repeated run duration in seconds.
 * @property {number | null} share Fraction of all run duration.
 * @property {number} missing_duration Run count without a usable duration.
 * @property {Record<RerunKind, RunTotals>} by_kind Totals by rerun reason.
 * @property {string[]} [efforts] Distinct effort values when multiple values occur.
 */

const RERUN_KINDS = ["defect", "supervisor", "spec", "environment", "unknown"];

// ステップ計画を登録する。切り直した時も同じコマンドで登録し直す(前の計画は残す)
export function registerPlan(args) {
  const root = gitRoot(path.resolve(args.root ?? "."));
  const task = args.task;
  const errors = [];
  if (!root) errors.push(`git のリポジトリではない: ${args.root ?? "."}`);
  if (!/^T\d+$/.test(task ?? "")) errors.push("--task は T<n>");
  let text = "";
  try { text = fs.readFileSync(args.file, "utf8"); } catch { errors.push(`計画のファイルを読めない: ${args.file ?? "(--file が無い)"}`); }
  const { steps, errors: planErrors } = parsePlan(text);
  if (text) errors.push(...planErrors);
  if (errors.length > 0) {
    emit({ errors }, null, 2);
    return;
  }
  const dir = taskDir(root, task);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const file = path.join(dir, "plan.md");
  const revised = fs.existsSync(file);
  if (revised) fs.renameSync(file, path.join(dir, `plan-${new Date().toISOString().replace(/[-:.]/g, "")}.md`));
  fs.writeFileSync(file, text);
  const status = statusWriter(root, task, null);
  status(`plan ${revised ? "revised" : "registered"}: ${steps.length} steps (${file})`);
  status(steps.map((s) => `  s${s.step}: ${s.purpose}`).join("\n"));
  recordWorklog(root, task, {
    kind: "plan", by: "runner", keys: { steps: steps.length, revised },
    text: steps.map((s) => `s${s.step} ${s.purpose}`).join(" / "),
  });
  emit({ task, root, plan_file: file, revised, steps }, null, 0);
}

// 計画の各ステップの状態。runs/ に run の記録があればそれを(実行中・中断はここでしか分からない)、
// 7 日を過ぎて消えたステップは worklog の run / verify の行から導く
export function stepStates(root, task, plan) {
  let names = [];
  try { names = fs.readdirSync(runsDir()).filter((n) => n.startsWith(`${task}-s`)); } catch { /* run がまだ無い */ }
  const latest = new Map();
  for (const name of names.sort()) { // 名前は <task>-s<step>-<時刻>-<pid> なので、並べると同じステップの後の run が後ろに来る
    const dir = path.join(runsDir(), name);
    let meta;
    try { meta = JSON.parse(fs.readFileSync(path.join(dir, "run.json"), "utf8")); } catch { continue; }
    if (meta.root === root) latest.set(meta.step, { dir, runs: (latest.get(meta.step)?.runs ?? 0) + 1 });
  }
  const entries = readWorklog(root, task)?.entries ?? [];
  const lock = activeWorkerLock(root);
  const readJson = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } };
  return plan.steps.map((s, index) => {
    const row = { index: index + 1, total: plan.steps.length, step: s.step, purpose: s.purpose, state: "未着手", runs: 0, verify: "", source: null };
    const run = latest.get(s.step);
    if (run) {
      const report = readJson(path.join(run.dir, "report.json"));
      const verified = readJson(path.join(run.dir, "verify.json"));
      if (lock?.runDir === run.dir) row.state = "実行中";
      else if (report) row.state = report.accepted ? `accepted(${report.worker?.status ?? "?"})` : "rejected";
      else row.state = "中断";
      if (verified) row.verify = verified.all_passed ? "verify ok" : `verify ${verified.failed} 件失敗`;
      Object.assign(row, { runs: run.runs, source: "runs" });
      return row;
    }
    const logged = entries.filter((e) => e.kind === "run" && e.step === `s${s.step}`);
    if (logged.length > 0) {
      const last = logged.at(-1);
      if (last.keys.stage === "interrupted") row.state = "中断";
      else row.state = last.keys.accepted === "true" ? `accepted(${last.keys.worker ?? "?"})` : "rejected";
      const verified = entries.filter((e) => e.kind === "verify" && e.keys.run === last.keys.run).at(-1);
      if (verified) row.verify = verified.keys.result === "ok" ? "verify ok" : `verify ${verified.keys.result.replace(/^fail:/, "")} 件失敗`;
      Object.assign(row, { runs: logged.length, source: "worklog" });
    }
    return row;
  });
}

/**
 * Aggregate rerun and superseded durations from ordered worklog entries.
 * @param {WorklogEntry[]} entries Parsed entries in worklog order.
 * @returns {{ reruns: RerunSummary, superseded: SupersededSummary }}
 */
function summarizeRunReruns(entries) {
  const runs = entries.filter((entry) => entry.kind === "run");
  const lastRunByStep = new Map();
  for (const [index, entry] of runs.entries()) lastRunByStep.set(entry.step, index);

  const totalSeconds = runs.reduce((sum, entry) => sum + durationSeconds(entry), 0);

  const rerunTotals = { runs: 0, seconds: 0 };
  const superseded = { runs: 0, seconds: 0 };
  const byKind = Object.fromEntries(RERUN_KINDS.map((kind) => [kind, { runs: 0, seconds: 0 }]));

  const effortValues = [...new Set(runs.map((entry) => entry.keys.effort).filter(Boolean))];
  let missingDuration = 0;
  const priorSteps = new Set();

  for (const [index, entry] of runs.entries()) {
    const duration = durationValue(entry);
    const hasPriorRun = priorSteps.has(entry.step);
    priorSteps.add(entry.step);
    if (duration === null) missingDuration += 1;

    if (lastRunByStep.get(entry.step) > index) {
      superseded.runs += 1;
      superseded.seconds += duration ?? 0;
    }

    if (!hasPriorRun) continue;
    if (entry.keys.rerun === "replan") continue;

    const kind = RERUN_KINDS.includes(entry.keys.rerun) ? entry.keys.rerun : "unknown";
    rerunTotals.runs += 1;
    rerunTotals.seconds += duration ?? 0;
    byKind[kind].runs += 1;
    byKind[kind].seconds += duration ?? 0;
  }

  const reruns = {
    ...rerunTotals,
    share: durationShare(rerunTotals.seconds, totalSeconds),
    missing_duration: missingDuration,
    by_kind: byKind,
    ...(effortValues.length > 1 ? { efforts: effortValues } : {}),
  };

  return {
    reruns,
    superseded: { ...superseded, share: durationShare(superseded.seconds, totalSeconds) },
  };
}

/** Read a duration only when its worklog value is a nonnegative integer string.
 * @param {WorklogEntry} entry Worklog row to inspect.
 * @returns {number | null} Duration in seconds, or null when it is unusable.
 */
function durationValue(entry) {
  const value = entry.keys.duration;
  if (typeof value !== "string" || !/^\d+$/.test(value)) return null;

  const seconds = Number(value);
  return Number.isInteger(seconds) ? seconds : null;
}

/** Return zero for records without a usable duration.
 * @param {WorklogEntry} entry Worklog row to inspect.
 * @returns {number} Usable duration in seconds or zero.
 */
function durationSeconds(entry) {
  return durationValue(entry) ?? 0;
}

/** Round a duration share to three decimal places, or null for a zero denominator.
 * @param {number} seconds Numerator duration in seconds.
 * @param {number} totalSeconds Denominator duration in seconds.
 * @returns {number | null} Rounded share, or null when the denominator is zero.
 */
function durationShare(seconds, totalSeconds) {
  return totalSeconds === 0 ? null : Math.round((seconds / totalSeconds) * 1000) / 1000;
}

/** Format the human-readable rerun summary as one Japanese line.
 * @param {{ reruns: RerunSummary, superseded: SupersededSummary }} summary Aggregated run data.
 * @returns {string} One-line summary for the show table.
 */
function formatRerunsLine({ reruns, superseded }) {
  const share = reruns.share === null ? "-" : `${(reruns.share * 100).toFixed(1)}%`;
  const detail = RERUN_KINDS.map((kind) =>
    `${kind} ${reruns.by_kind[kind].runs} 件 ${reruns.by_kind[kind].seconds}s`).join(", ");
  const efforts = reruns.efforts ? ` / efforts: ${reruns.efforts.join(",")}` : "";
  const rerunText = `reruns: ${reruns.runs} 件 ${reruns.seconds}s (${share})`;
  const supersededText = `${superseded.runs} 件 ${superseded.seconds}s`;

  return `${rerunText} / superseded: ${supersededText} / 内訳: ${detail}${efforts}`;
}

/** Map each step to the effort on its latest run record.
 * @param {WorklogEntry[]} entries Parsed worklog entries.
 * @returns {Map<string, string | null>} Latest run effort by step identifier.
 */
function latestEffortsByStep(entries) {
  const efforts = new Map();
  for (const entry of entries) {
    if (entry.kind === "run" && entry.step) {
      efforts.set(entry.step, entry.keys.effort ?? null);
    }
  }

  return efforts;
}

// 計画の各ステップについて、最新の run の状態と verify の結果を人向けの表(--json なら JSON)で出す
export function showTask(args) {
  const root = gitRoot(path.resolve(args.root ?? "."));
  const task = args.task;
  const plan = root && /^T\d+$/.test(task ?? "") ? readPlan(root, task) : null;
  if (!plan) {
    if (args.json) emit({ errors: [`${task ?? "(--task が無い)"} のステップ計画が無い(${root ?? args.root ?? "."})`] }, null, 2);
    else {
      process.stderr.write(`${task ?? "(--task が無い)"} のステップ計画が無い(${root ?? args.root ?? "."})\n`);
      process.exitCode = 2;
    }
    return;
  }
  const entries = readWorklog(root, task)?.entries ?? [];
  const { reruns, superseded } = summarizeRunReruns(entries);
  const effortsByStep = latestEffortsByStep(entries);
  const states = stepStates(root, task, plan).map((state) => ({
    ...state,
    effort: effortsByStep.get(`s${state.step}`) ?? null,
  }));
  if (args.json) {
    const status = ledgerWorktreeStatus(root, task);
    emit({
      task,
      root,
      plan_file: plan.file,
      steps: states,
      reruns,
      superseded,
      ...(status === null ? {} : { worktree: status }),
    }, null, 0);
    return;
  }
  const rows = states.map((s) => [`${s.index}/${s.total} s${s.step}`, s.runs > 1 ? `${s.state} ×${s.runs}` : s.state, s.verify, s.purpose]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => [...r[i]].length)));
  const pad = (text, width) => text + " ".repeat(width - [...text].length);
  const lines = [`${task} ${root}`, `計画: ${plan.file}`, ""];
  for (const r of rows) lines.push(`${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${r[3]}`);
  lines.push(
    "",
    formatRerunsLine({ reruns, superseded }),
    `packet の写し: ${path.dirname(plan.file)}/s<番号>.packet.md(最新)、s<番号>-<run_id>.packet.md(run ごと)`,
  );
  process.stdout.write(lines.join("\n") + "\n");
}

// 監督(Codex ホストでは本人)がステップの境目の結論を worklog に 1 行書く
export function noteTask(args) {
  const root = gitRoot(path.resolve(args.root ?? "."));
  const task = args.task;
  const errors = [];
  if (!root) errors.push(`git のリポジトリではない: ${args.root ?? "."}`);
  if (!/^T\d+$/.test(task ?? "")) errors.push("--task は T<n>");
  if (!NOTE_KINDS.includes(args.kind)) errors.push(`--kind は ${NOTE_KINDS.join(" / ")} のどれか`);
  if (!String(args.text ?? "").trim()) errors.push("--text が空(結論を 1 行で書く)");
  if (errors.length > 0) {
    emit({ errors }, null, 2);
    return;
  }
  const keys = {};
  if (args.from) keys.from = normalizeStep(args.from);
  if (args.changed === "auto") keys.changed = dirtyWorktree(root);
  else if (args.changed) keys.changed = args.changed.split(",").map((p) => p.trim().replace(/^\.\//, "")).filter(Boolean);
  const thread = process.env.CODEX_THREAD_ID;
  const by = thread ? `codex:${thread.slice(0, 8)}` : "claude";
  const { file, line } = appendWorklog(root, task, { kind: args.kind, step: args.step, by, keys, text: args.text });
  emit({ task, root, worklog: file, entry: line }, null, 0);
}

// 作業記録で説明できるパス(workspace が null なら帳簿の root の、そうでなければその作業場所の):
// 最初の run の前から未コミットだったパス・受け入れた run の変更・Codex ホストが step で
// 記録した変更(step は root のみ)
export function explainedPaths(entries, workspace) {
  const paths = [];
  for (const e of entries) {
    const own = e.kind === "run" && runWorkspace(e) === workspace;
    if (own && e.keys.baseline) paths.push(...e.keys.baseline);
    if (own && e.keys.accepted === "true" && e.keys.changed) paths.push(...e.keys.changed);
    if (workspace === null && e.kind === "step" && e.keys.changed) paths.push(...e.keys.changed);
  }

  return paths;
}

// 作業場所の未コミットの変更と、作業記録で説明できないもの。作業場所を読めなければ error に理由を
// 入れる(呼び出し元が説明できない変更に数え、再開を止める)
export function workspaceDirt(entries, workspace) {
  let dirty;
  try {
    dirty = dirtyWorktree(workspace);
  } catch (error) {
    const reason = `作業場所を読めない: ${error.message.split("\n")[0]}`;
    return { workspace, dirty: [], unexplained_dirty: [], error: reason };
  }

  const explained = explainedPaths(entries, workspace);
  const unexplained = dirty.filter((p) => !explained.some((a) => isInside(p, a, workspace)));

  return { workspace, dirty, unexplained_dirty: unexplained };
}

/** Read optional worktree status, converting only known record and Git failures to an error value.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @returns {import("../worktree/state.mjs").WorktreeStatus | { error: string } | null}
 */
function ledgerWorktreeStatus(root, task) {
  try {
    return worktreeStatus(root, task);
  } catch (error) {
    if (
      !(error instanceof SyntaxError)
      && !(error instanceof TypeError)
      && !hasNodeSystemErrorCode(error)
      && !hasProcessExitStatus(error)
    ) throw error;
    return { error: processErrorText(error) };
  }
}

/** Identify an integrated or discarded logged worktree whose record and directory are gone.
 * @param {string} root Ledger root.
 * @param {string} task Task identifier.
 * @param {Array<WorkspaceRunEntry>} entries Worklog entries for this task.
 * @param {string} workspace Logged workspace path.
 * @returns {boolean} Whether this workspace satisfies the removed-worktree contract.
 */
function removedWorkspace(root, task, entries, workspace) {
  const hasBranchRun = entries.some((entry) =>
    entry.kind === "run" && runWorkspace(entry) === workspace && Boolean(entry.keys.branch));
  if (!hasBranchRun || fs.existsSync(workspace)) return false;

  try {
    return readWorktreeRecord(root, task) === null;
  } catch (error) {
    if (
      !(error instanceof SyntaxError)
      && !(error instanceof TypeError)
      && !hasNodeSystemErrorCode(error)
    ) throw error;
    return false;
  }
}

// 同じ T の再開の照合。未コミットの変更が、作業記録で説明できるもの(最初の run の前から未コミットだったパス・
// 受け入れた run の変更・Codex ホストが step で記録した変更・状態文書)だけかを確かめる
export function resumeTask(args) {
  const root = gitRoot(path.resolve(args.root ?? "."));
  const task = args.task;
  const errors = [];
  if (!root) errors.push(`git のリポジトリではない: ${args.root ?? "."}`);
  if (!/^T\d+$/.test(task ?? "")) errors.push("--task は T<n>");
  if (errors.length > 0) {
    emit({ errors }, null, 2);
    return;
  }
  const log = readWorklog(root, task);
  const entries = log?.entries ?? [];
  const plan = readPlan(root, task);

  const dirty = dirtyWorktree(root);
  const explained = [...ALWAYS_ALLOWED, ...explainedPaths(entries, null)];
  const unexplained = dirty.filter((p) => !explained.some((a) => isInside(p, a, root)));

  const workspaceNames = [...new Set(entries.map(runWorkspace).filter(Boolean))];
  const workspaces = workspaceNames.map((workspace) =>
    removedWorkspace(root, task, entries, workspace)
      ? { workspace, dirty: [], unexplained_dirty: [], removed: true }
      : workspaceDirt(entries, workspace));
  // 作業場所の説明できない変更は絶対パスで足す(空でなければ再開しない、という読み手の規則を
  // 変えないため)
  const unexplainedInWorkspaces = workspaces
    .flatMap((w) => (w.error
      ? [`${w.workspace}(${w.error})`]
      : w.unexplained_dirty.map((p) => path.join(w.workspace, p))));

  const last = (kind) => entries.filter((e) => e.kind === kind).at(-1) ?? null;
  const lock = activeWorkerLock(root);
  const status = ledgerWorktreeStatus(root, task);
  emit({
    task, root,
    exists: entries.length > 0,
    worklog: log?.file ?? null,
    plan_file: plan?.file ?? null,
    steps: plan ? stepStates(root, task, plan) : [],
    last_handoff: last("handoff"),
    last_budget: last("budget"),
    last_resume: last("resume"),
    compacted: entries.some((e) => e.kind === "compact"),
    worker_running: lock ? { task: lock.task, step: lock.step } : null,
    dirty,
    unexplained_dirty: [...unexplained, ...unexplainedInWorkspaces],
    workspaces,
    ...(status === null ? {} : { worktree: status }),
  }, null, 0);
}
