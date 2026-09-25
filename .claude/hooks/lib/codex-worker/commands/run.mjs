// run の実行と run 記録の保持期間を管理する。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  gitRoot, hasNodeSystemErrorCode, hasProcessExitStatus, lockRoot,
  sameGitRepository, workspaceIsInsideRepo,
} from "../git.mjs";
import { readWorktreeRecordForRun } from "../worktree/record.mjs";
import {
  activeWorkerLock, canonical, workerLockPath,
} from "../../../check-task-scope.mjs";
import {
  buildPrompt, checkAllow, checkPacketCrossCheck, checkPacketVerify, packetVerifyCommands,
  gate, readRollout, restore, selectRules, takeSnapshot,
  validateResult, normalizeAllow, workspaceErrors,
} from "../core.mjs";
import { renderSummary } from "../status.mjs";
import { timingMetrics } from "../timing.mjs";
import { readPlan, readWorklog, runsDir, taskDir } from "../worklog.mjs";
import { ensureWorktree } from "../worktree.mjs";
import {
  emit, recordWorklog, runWorkspace, statusWriter, stepLabel,
} from "../output.mjs";
import {
  DEFAULTS, execWorker, killGroup, locateRollout, privateUvCache, readEvents, resolveModel,
  runId, sandboxErrors, workerHome, workerHomeErrors,
} from "../worker.mjs";

const here = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

export function pruneOldRuns() {
  let names;
  try { names = fs.readdirSync(runsDir()); } catch { return; }
  for (const name of names) {
    const dir = path.join(runsDir(), name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > RUN_RETENTION_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 競合で消えた */ }
  }
}

/** Resolve the task worktree after checking the source workspace and mixed-mode history.
 * @param {{ root: string, task: string, workspace: string }} options
 * @returns {{
 *   workspace: string,
 *   worktree: { repo: string, path: string, branch: string } | null,
 *   relocate: { from: string, to: string } | null,
 *   errors: string[]
 * }}
 */
export function prepareWorktreeRun({ root, task, workspace }) {
  const errors = workspaceErrors(root, workspace);
  if (errors.length > 0) {
    return { workspace, worktree: null, relocate: null, errors };
  }

  const repo = gitRoot(workspace);
  if (!repo) {
    return {
      workspace, worktree: null, relocate: null,
      errors: [`作業場所が git のリポジトリではない: ${workspace}`],
    };
  }
  const mainRepo = canonical(repo);
  if (sameGitRepository(root, mainRepo) !== false) {
    return {
      workspace, worktree: null, relocate: null,
      errors: [`--workspace は帳簿と別のリポジトリが必要: ${mainRepo}`],
    };
  }

  const legacyRun = (readWorklog(root, task)?.entries ?? []).some((entry) => {
    if (
      entry.kind !== "run"
      || entry.keys.accepted !== "true"
      || Object.hasOwn(entry.keys, "branch")
      || typeof entry.keys.workspace !== "string"
    ) return false;

    const sameRepository = sameGitRepository(entry.keys.workspace, mainRepo);
    return sameRepository === true
      || (sameRepository === null && workspaceIsInsideRepo(entry.keys.workspace, mainRepo));
  });
  if (legacyRun) {
    return {
      workspace, worktree: null, relocate: null,
      errors: [`同じ本体リポジトリの branch なし accepted run がある: ${mainRepo}`],
    };
  }

  let ensured;
  try {
    ensured = ensureWorktree({ root, task, repo: mainRepo });
  } catch (error) {
    if (!(error instanceof SyntaxError) && !(error instanceof TypeError)
      && !hasNodeSystemErrorCode(error) && !hasProcessExitStatus(error)) throw error;
    const message = error instanceof Error ? error.message : String(error);
    return {
      workspace, worktree: null, relocate: null,
      errors: [`worktree を準備できない: ${message}`],
    };
  }
  if (!ensured.ok) {
    return { workspace, worktree: null, relocate: null, errors: ensured.errors };
  }

  const relativeWorkspace = path.relative(mainRepo, workspace);
  const effectiveWorkspace = canonical(path.join(ensured.record.path, relativeWorkspace));
  return {
    workspace: effectiveWorkspace,
    worktree: {
      repo: ensured.record.repo,
      path: ensured.record.path,
      branch: ensured.record.branch,
    },
    relocate: { from: mainRepo, to: ensured.record.path },
    errors: [],
  };
}

export async function run(args) {
  const requestedRoot = path.resolve(args.root ?? ".");
  const root = gitRoot(requestedRoot);
  const task = args.task;
  const step = args.step;
  const requestedAllow = (args.allow ?? []).map((a) => a.replace(/^\.\//, ""));
  // 作業場所はリポジトリの中のサブディレクトリでもよい(最上位へ引き上げない)。symlink は実体パスへ
  // 解決する
  let workspace = args.workspace ? canonical(path.resolve(args.workspace)) : root;
  let worktree = null;
  let relocate = null;
  const home = workerHome();
  const timeoutSec = Number(args.timeout ?? DEFAULTS.timeout);
  const maxPacket = Number(args["max-packet"] ?? DEFAULTS.maxPacket);
  const maxAllow = Number(args["max-allow"] ?? DEFAULTS.maxAllow);
  const peakThreshold = Number(args["peak-threshold"] ?? DEFAULTS.peakThreshold);

  const errors = [];
  const validTask = /^T\d+$/.test(task ?? "");
  if (args.worktree) {
    if (!args.workspace) errors.push("--worktree を使うには --workspace が必要");
    if (!root) errors.push(`git のリポジトリではない: ${requestedRoot}`);
    if (!validTask) errors.push("--task は T<n>");
    if (errors.length > 0) {
      emit({ accepted: false, stage: "preflight", errors, warnings: [] }, null, 2);
      return;
    }

    const prepared = prepareWorktreeRun({ root, task, workspace });
    errors.push(...prepared.errors);
    if (errors.length > 0) {
      emit({ accepted: false, stage: "preflight", errors, warnings: [] }, null, 2);
      return;
    }
    workspace = prepared.workspace;
    worktree = prepared.worktree;
    relocate = prepared.relocate;
  } else if (root && validTask) {
    const { record, errors: recordErrors } = readWorktreeRecordForRun(root, task);
    errors.push(...recordErrors);
    const sameRepository = record ? sameGitRepository(workspace, record.repo) : false;
    if (record && (
      sameRepository === true
      || (sameRepository === null && workspaceIsInsideRepo(workspace, record.repo))
    )) {
      errors.push(
        `worktree.json の本体リポジトリでは --worktree が必要: ${record.repo}`,
      );
    }
  }

  // 作業記録に残す作業場所(root と同じなら無し)
  const loggedWorkspace = workspace === root ? null : workspace;
  if (!root) errors.push(`git のリポジトリではない: ${requestedRoot}`);
  if (!validTask) errors.push("--task は T<n>");
  if (!step) errors.push("--step が無い");
  if (!args.packet) errors.push("--packet が無い");
  let packet = "";
  if (args.packet) {
    try { packet = fs.readFileSync(args.packet, "utf8"); } catch { errors.push(`packet を読めない: ${args.packet}`); }
  }
  const packetBytes = Buffer.byteLength(packet);
  if (packetBytes > maxPacket) {
    errors.push(`packet が ${packetBytes} バイトで上限 ${maxPacket} を超える。ステップを小さく切り、意図の層(背景・兄弟タスク・将来計画)を削る`);
  }
  if (args.packet && packet !== "") errors.push(...checkPacketCrossCheck(packet), ...checkPacketVerify(packet));
  errors.push(...workerHomeErrors(home));
  const workspaceProblems = root && args.workspace ? workspaceErrors(root, workspace) : [];
  errors.push(...workspaceProblems);
  const workspaceOptions = { workspace, ...(relocate ? { relocate } : {}) };
  const normalized = root && workspaceProblems.length === 0
    ? normalizeAllow(requestedAllow, workspaceOptions)
    : { allow: requestedAllow, errors: [] };
  errors.push(...normalized.errors);
  const allow = normalized.allow;
  const allowCheck = root && /^T\d+$/.test(task ?? "") && workspaceProblems.length === 0
    ? checkAllow(root, task, allow, maxAllow, workspaceOptions)
    : { errors: [], warnings: [] };
  errors.push(...allowCheck.errors);
  const plan = root && /^T\d+$/.test(task ?? "") ? readPlan(root, task) : null;
  if (root && /^T\d+$/.test(task ?? "") && step) {
    if (!plan) errors.push(`${task} のステップ計画が無い。最初の worker を起動する前に cli.mjs plan で登録する`);
    else if (!plan.steps.some((s) => s.step === step)) {
      errors.push(`ステップ ${step} が ${task} の計画(${plan.file})に無い。ステップを切り直したなら cli.mjs plan で計画を登録し直す`);
    }
  }
  const running = root ? activeWorkerLock(lockRoot(workspace)) ?? activeWorkerLock(root) : null;
  if (running) errors.push(`別の worker が実行中: ${running.task} ステップ ${running.step}`);
  if (errors.length === 0) errors.push(...sandboxErrors(home, workspace));
  const resolved = errors.length === 0 ? resolveModel(args, home) : { model: null };
  if (resolved.error) errors.push(resolved.error);
  if (errors.length > 0) {
    emit({ accepted: false, stage: "preflight", errors, warnings: allowCheck.warnings }, null, 2);
    return;
  }
  const model = resolved.model;

  pruneOldRuns();
  const id = runId(task, step);
  const runDir = path.join(runsDir(), id);
  fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const snapshot = worktree
    ? takeSnapshot(workspace, runDir, { refScope: [`refs/heads/${worktree.branch}`] })
    : takeSnapshot(workspace, runDir);
  const runMeta = { root, workspace, task, step, model, allow, ...(worktree ? { worktree } : {}) };
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify(runMeta, null, 2));
  fs.writeFileSync(path.join(runDir, "packet.md"), packet); // verify が検証節を読む
  try { fs.writeFileSync(path.join(taskDir(root, task), `s${step}.packet.md`), packet); } catch { /* 写しは人が読むためのもの */ }
  // 作業場所 → そのリポジトリの最上位 → 帳簿の root の順(重なりは除く)
  const ruleRoots = [...new Set([workspace, gitRoot(workspace) ?? workspace, root])];
  const { rules, conservative } = selectRules(workspace, allow, ruleRoots);
  const contract = fs.readFileSync(path.join(here, "worker-contract.md"), "utf8");
  const prompt = buildPrompt({ contract, allow, packet, rules });
  fs.writeFileSync(path.join(runDir, "prompt.md"), prompt);

  const status = statusWriter(root, task, stepLabel(plan, step));
  const uvCache = privateUvCache(id);

  // ロックとシグナル: runner が止められても codex を孤児にせず、ロックを残さない
  // ロックのファイルは作業場所のリポジトリの最上位の単位(lockRoot)で置き、lock.root には作業場所を
  // 書く(check-task-scope.mjs は lock.root の中の Claude 側の編集を止める)。taskRoot は、帳簿の
  // root しか知らない task-loop と resume が activeWorkerLock(root) で見つけるため
  const lockFile = workerLockPath(lockRoot(workspace));
  const expiresAt = Date.now() + (timeoutSec + 60) * 1000;
  const lock = { root: workspace, taskRoot: root, task, step, runDir, pid: process.pid, expiresAt };
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  let child = null;
  const onSignal = (signal) => {
    if (child) killGroup(child, "SIGKILL");
    fs.rmSync(lockFile, { force: true });
    fs.rmSync(uvCache, { recursive: true, force: true });
    status(`interrupted by ${signal}(作業ツリーは戻していない)`);
    recordWorklog(root, task, {
      kind: "run", step, by: "runner",
      keys: {
        run: id, accepted: false, stage: "interrupted", ...(loggedWorkspace ? { workspace } : {}),
        ...(worktree ? { branch: worktree.branch } : {}),
      },
      text: `runner が ${signal} で止められた。作業ツリーは戻していない`,
    });
    const interruptionReason = `runner が ${signal} で止められた。`
      + "作業ツリーは戻していない(restore --run で戻す)";
    emit({
      accepted: false,
      stage: "interrupted",
      run_dir: runDir,
      ...(worktree ? { worktree } : {}),
      reasons: [interruptionReason],
    }, runDir, 1);
    process.exit(1);
  };
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);

  status(`started: ${plan.steps.find((s) => s.step === step).purpose}`);
  const workspaceLabel = workspace === root ? "" : ` workspace=${workspace}`;
  const branchLabel = worktree ? ` branch=${worktree.branch}` : "";
  status(`model=${model} allow=${allow.join(",")}${workspaceLabel}${branchLabel} run=${runDir}`);
  const started = Date.now();
  let exec;
  let ended;
  try {
    exec = await execWorker({
      home, model, root: workspace, prompt, runDir, timeoutSec, uvCache, status,
      onStart: (c) => {
        child = c;
        fs.writeFileSync(lockFile, JSON.stringify({ ...lock, childPid: c.pid }));
      },
    });
    ended = Date.now();
  } finally {
    fs.rmSync(lockFile, { force: true });
    fs.rmSync(uvCache, { recursive: true, force: true });
    for (const signal of signals) process.off(signal, onSignal);
  }
  const durationSec = Math.round((ended - started) / 1000);

  const reasons = [];
  let checked = { changed: [], violations: [], repoChanges: [], ignoredDirs: [], ignoredFiles: [] };
  let restoreResult = { restored: [], unrestorable: [], backups: {} };
  let result = null;
  let context = { peakRatio: null, contextWindow: null, compacted: null };
  let rolloutFile = null;
  let usage = {};
  try {
    const events = readEvents(runDir);
    usage = events.usage;
    rolloutFile = events.threadId ? locateRollout(home, events.threadId, started) : null;
    if (rolloutFile) context = readRollout(rolloutFile);
    try { result = JSON.parse(fs.readFileSync(path.join(runDir, "result.json"), "utf8")); } catch { /* 欠落 */ }

    // 作業場所がプロジェクトの外の共有リポジトリなら、.gitignore 対象のファイル(ほかのプロセスの
    // ログや履歴)の変化は worker の違反に数えず、巻き戻さない
    checked = gate(snapshot, allow, { ignoredFiles: loggedWorkspace ? "warn" : "violation" });

    if (exec.spawnError) reasons.push(`codex を起動できない: ${exec.spawnError}`);
    if (exec.timedOut) reasons.push(`タイムアウト(${timeoutSec} 秒)`);
    else if (exec.code !== 0 && !exec.spawnError) reasons.push(`codex exec の終了コード ${exec.code}`);
    reasons.push(...validateResult(result));
    if (!rolloutFile) reasons.push("rollout が見つからず compaction を確認できない");
    if (context.compacted > 0) reasons.push(`worker のコンテキストが compaction された(${context.compacted} 回)。同じ packet で再試行せず、ステップを小さく切る`);
    if (checked.repoChanges.length > 0) reasons.push(`worker が git の状態を変えた: ${checked.repoChanges.join(", ")}(自動では戻さない。監督が確認する)`);
    if (checked.violations.length > 0) reasons.push(`許可パスの外を変更した: ${checked.violations.join(", ")}`);

    // 機構上の失敗はステップの変更をすべて戻す。許可外の変更だけなら、その分だけ戻す。git の状態が変わったら触らない
    const mechanical = reasons.length > 0 && !(reasons.length === 1 && checked.violations.length > 0);
    const unowned = new Set([...checked.ignoredDirs, ...checked.ignoredFiles]);
    const targets = mechanical
      ? checked.changed.filter((p) => !unowned.has(p))
      : checked.violations;
    if (targets.length > 0 && checked.repoChanges.length === 0) {
      restoreResult = restore(snapshot, targets, path.join(runDir, "overwritten"));
    }
  } catch (error) {
    reasons.push(`runner の事後処理で例外(作業ツリーは戻し切れていない可能性がある。restore --run で戻す): ${error.message}`);
  }

  const report = {
    run_id: id,
    run_dir: runDir,
    task,
    step,
    workspace,
    ...(worktree ? { worktree } : {}),
    model,
    model_family: resolved.family ?? null,
    accepted: reasons.length === 0,
    reasons,
    warnings: [
      ...allowCheck.warnings,
      ...(conservative ? ["許可パスに中身の無いディレクトリがあり、paths 付きの規約も全部付けた"] : []),
      ...(checked.ignoredDirs.length > 0 ? [`.gitignore 対象のディレクトリが出入りした(違反にはしていない): ${checked.ignoredDirs.join(", ")}`] : []),
      ...(checked.ignoredFiles.length > 0
        ? [`.gitignore 対象のファイルが変わった(違反にも復元もしていない): ${
          checked.ignoredFiles.join(", ")}`]
        : []),
    ],
    slice_too_large: context.peakRatio !== null && context.peakRatio > peakThreshold,
    worker: result,
    gate: {
      changed: checked.changed, violations: checked.violations, repo_changes: checked.repoChanges,
      ignored_dirs: checked.ignoredDirs, ignored_files: checked.ignoredFiles,
    },
    restore: restoreResult,
    rules: rules.map((r) => r.file),
    metrics: {
      peak_ratio: context.peakRatio,
      context_window: context.contextWindow,
      compacted: context.compacted,
      ...usage,
      duration_s: durationSec,
      ...timingMetrics(exec.timedEvents, {
        startMs: started,
        endMs: ended,
        verifyCommands: packetVerifyCommands(packet),
      }),
      runner_s: Math.round(process.uptime()),
      packet_bytes: packetBytes,
      prompt_bytes: Buffer.byteLength(prompt),
    },
    rollout: rolloutFile,
  };
  status(renderSummary(report));
  // 再開の照合の材料を run の記録(7 日で消える)の外に残す。その T のその作業場所で最初の run には、
  // worker の起動前から未コミットだったパス(利用者や監督の変更)を baseline として添える。
  // 作業場所が root と違えば workspace に残す
  const pastRuns = (readWorklog(root, task)?.entries ?? []).filter((e) => e.kind === "run");
  const firstRun = !pastRuns.some((e) => runWorkspace(e) === loggedWorkspace);
  recordWorklog(root, task, {
    kind: "run", step, by: "runner",
    keys: {
      run: id, accepted: report.accepted, worker: result?.status ?? "none", changed: checked.changed,
      ...(loggedWorkspace ? { workspace } : {}),
      ...(worktree ? { branch: worktree.branch } : {}),
      ...(firstRun ? { baseline: Object.entries(snapshot.files).filter(([, f]) => !f.ignored).map(([p]) => p) } : {}),
    },
    text: report.accepted ? `accepted: ${plan.steps.find((s) => s.step === step).purpose}` : reasons.join(" / "),
  });
  emit(report, runDir, report.accepted ? 0 : 1);
}
