#!/usr/bin/env node
// Claude Code の /execute-task が、実装ステップ 1 つを Codex worker(codex exec)へ委譲するための runner。
// 監督の手順の正は ~/.claude/templates/codex-worker.md。
//
// 呼び出し規約:
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs run --root <プロジェクトルート> --task T<n> --step <番号>
//        --packet <packet.md> --allow <パス> [--allow <パス> ...(既定で 3 件まで)]
//        [--model-family <luna|terra|sol ...> | --model <モデル ID>] [--timeout <秒>]
//        [--max-packet <バイト>] [--max-allow <件数>] [--peak-threshold <0〜1>]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs restore --run <run ディレクトリ> [--keep <残すパス> ...]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs verify --run <run ディレクトリ> [--timeout <1 本あたりの秒>]
//   worker 用 CODEX_HOME は環境変数 CODEX_WORKER_HOME(既定 ~/.codex-worker、.codex/install.sh が作る)。
//   モデルは既定で系統 luna(model-routing.md の通常実装)を、`codex debug models` の一覧の最新の版へ解決する。
//   版番号をどこにも固定しないため。--model は解決を飛ばして ID を直接渡す(一覧に無いモデルを試す時だけ)。
//   実行中の状態行(コマンド・編集したファイル・進捗・トークン・判定)は stderr と
//   ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/status/<ルートのパスの記号を - にした名前>.log に出す
//   (人が追うためのもの。report ではない。プロジェクトごとに分けるのは、同じリポジトリでは worker が同時に 1 つなので
//   混ざらないため)。
//   run の記録は ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/runs/ に置く(worker の sandbox は
//   TMPDIR と /tmp に書けるので、restore の元になる退避コピーをそこに置かない)。7 日より古い記録は run の度に消す。
//
// run の流れ: 起動前検査(許可パス ⊆ T の対象、件数の上限、状態文書を含まない、packet の大きさ、worker 環境、
// 実行中の別 worker、モデルの解決)→ snapshot → ロック(check-task-scope.mjs が Claude 側の編集を止める)→
// codex exec(独立したプロセスグループ。タイムアウトとシグナルでグループごと止める)→ ロック解除 →
// rollout からピーク使用率と compaction → ゲート → 必要なら restore(上書き前に現在の内容を退避)→ report。
//
// 出力規約: どの経路でも JSON を 1 つ stdout に出す(run は <run ディレクトリ>/report.json にも保存)。
//   exit 0 = accepted(機構上の失敗なし。worker の status が blocked / failed でも監督の判断材料として有効)
//   exit 1 = 不採用(reasons に理由。restore.restored は snapshot 時点へ戻したパス、restore.unrestorable は
//            自動では戻せなかったパス、restore.backups は上書き前の内容の退避先)
//   exit 2 = 起動前に拒否、または引数・記録の誤り(worker を起動していない / 何も変更していない)
// restore は、監督が accepted の結果を採らないと決めた時に、そのステップの許可パスの中の変更を snapshot 時点へ
// 戻す(許可パスの外は触らない)。--keep を渡すと、そのパスの中の変更は残す。
// verify は、run の packet の「## 検証」節のコマンドを監督の環境(worker の sandbox の外)で 1 本ずつ別々に打ち、
// コマンドごとの終了コードを JSON で stdout と <run ディレクトリ>/verify.json に出す。
//   exit 0 = 全部 0、exit 1 = 0 でないものがある、exit 2 = 記録の誤り・worker の実行中(何も打っていない)

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { StringDecoder } from "node:string_decoder";
import { activeWorkerLock, isInside, workerLockPath } from "../../check-task-scope.mjs";
import {
  buildPrompt, changedSince, checkAllow, checkPacketCrossCheck, checkPacketVerify, findRollout, packetVerifyCommands, gate, readRollout, resolveModelFamily, restore, selectRules,
  takeSnapshot, validateResult,
} from "./core.mjs";
import { lineSplitter, renderEvent, renderSummary } from "./status.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = { timeout: 1200, maxPacket: 12 * 1024, maxAllow: 3, peakThreshold: 0.6, family: "luna" };
const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_LOG_MAX = 1024 * 1024;
const VERIFY_TIMEOUT_SEC = 900;
const VERIFY_TAIL_LINES = 30;

function emit(report, runDir, code) {
  const text = JSON.stringify(report, null, 2);
  if (runDir) {
    try { fs.writeFileSync(path.join(runDir, "report.json"), text); } catch { /* stdout には出す */ }
  }
  process.stdout.write(text + "\n");
  process.exitCode = code;
}

function stateDir() {
  const base = process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state");
  return path.join(base, "claude-codex-worker");
}

function runsDir() {
  return path.join(stateDir(), "runs");
}

// 状態行のプロジェクトごとのログ。名前は ~/.claude/projects/ と同じく、ルートのパスの記号を - にしたもの
function statusLogPath(root) {
  return path.join(stateDir(), "status", `${root.replace(/[^A-Za-z0-9]/g, "-")}.log`);
}

// 状態行の出力先。stderr(Claude Code のバックグラウンドタスクの表示・手で起動した端末)と、
// 別の端末から `tail -F` で追えるプロジェクトごとのログ。表示の失敗で run を止めない
function statusWriter(root, task, step) {
  const logFile = statusLogPath(root);
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 }); } catch { /* 表示のみ */ }
  try {
    if (fs.statSync(logFile).size > STATUS_LOG_MAX) fs.truncateSync(logFile, 0);
  } catch { /* 初回 */ }
  const prefix = `[Codex ${task} s${step}]`;
  return (text) => {
    if (!text) return;
    const out = text.split("\n").map((line) => `${prefix} ${line}\n`).join("");
    try { process.stderr.write(out); } catch { /* 表示のみ */ }
    try { fs.appendFileSync(logFile, out); } catch { /* 表示のみ */ }
  };
}

function pruneOldRuns() {
  let names;
  try { names = fs.readdirSync(runsDir()); } catch { return; }
  for (const name of names) {
    const dir = path.join(runsDir(), name);
    try {
      if (Date.now() - fs.statSync(dir).mtimeMs > RUN_RETENTION_MS) fs.rmSync(dir, { recursive: true, force: true });
    } catch { /* 競合で消えた */ }
  }
}

function gitRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
}

function workerHomeErrors(home) {
  const errors = [];
  if (!fs.existsSync(path.join(home, "config.toml"))) errors.push(`worker 用ホームに config.toml が無い: ${home}(.codex/install.sh を実行)`);
  let auth;
  try { auth = fs.lstatSync(path.join(home, "auth.json")); } catch { auth = null; }
  if (!auth) errors.push(`worker 用ホームに auth.json が無い: ${home}`);
  else if (!auth.isSymbolicLink()) {
    errors.push(`worker 用ホームの auth.json がリンクでなくなっている(認証が通常ホームと分かれた): ${home}。通常ホームの認証を確認し、.codex/install.sh で張り直す`);
  } else if (!fs.existsSync(path.join(home, "auth.json"))) errors.push("worker 用ホームの auth.json のリンク先が無い");
  if (fs.existsSync(path.join(home, "AGENTS.md"))) errors.push(`worker 用ホームに AGENTS.md がある(worker が開始手順で文書を読み直す): ${home}`);
  return errors;
}

function resolveModel(args, home) {
  if (args.model) return { model: args.model };
  const family = args["model-family"] ?? DEFAULTS.family;
  let catalog;
  try {
    catalog = JSON.parse(execFileSync("codex", ["debug", "models"], {
      encoding: "utf8", env: { ...process.env, CODEX_HOME: home }, stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024,
    }));
  } catch (error) {
    return { error: `モデル一覧(codex debug models)を読めない: ${error.message}` };
  }
  const model = resolveModelFamily(family, catalog);
  return model ? { model, family } : { error: `系統 ${family} のモデルが一覧に無い` };
}

function runId(task, step) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  return `${task}-s${step}-${stamp}-${process.pid}`;
}

// codex を独立したプロセスグループで起動し、止める時はグループごと止める(codex が起動したシェルの子も含む)
function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { /* 既に終了 */ }
}

// 生のイベントは events.jsonl にそのまま保存し、状態行は status.mjs が選んだものだけを出す
function execWorker({ home, model, root, prompt, runDir, timeoutSec, onStart, status }) {
  return new Promise((resolve) => {
    const events = fs.openSync(path.join(runDir, "events.jsonl"), "w");
    const stderr = fs.openSync(path.join(runDir, "stderr.txt"), "w");
    const splitter = lineSplitter((line) => {
      let event;
      try { event = JSON.parse(line); } catch { return; }
      status(renderEvent(event, { root }));
    });
    const child = spawn("codex", [
      "exec", "--json", "-s", "workspace-write", "-m", model, "-C", root,
      "--output-schema", path.join(here, "worker-result.schema.json"),
      "-o", path.join(runDir, "result.json"), "-",
    ], { env: { ...process.env, CODEX_HOME: home }, stdio: ["pipe", "pipe", stderr], detached: true });
    const decoder = new StringDecoder("utf8"); // チャンク境界で割れた多バイト文字を持ち越す
    child.stdout.on("data", (chunk) => {
      fs.writeSync(events, chunk);
      splitter.push(decoder.write(chunk));
    });
    child.stdout.on("end", () => {
      splitter.push(decoder.end());
      splitter.end();
    });
    // stdout は pipe なので、codex の終了後に孫が pipe を握っていると close が来ない。exit でグループを止める
    child.on("exit", () => killGroup(child, "SIGKILL"));
    onStart(child);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), 10_000).unref();
    }, timeoutSec * 1000);
    child.on("error", (error) => { clearTimeout(timer); resolve({ code: null, timedOut, spawnError: error.message }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup(child, "SIGKILL"); // codex 本体が終わった後に残った子を止める(gate の後に書き込ませない)
      resolve({ code, timedOut });
    });
    child.stdin.on("error", () => { /* 起動直後に終了した */ });
    child.stdin.end(prompt);
  });
}

function readEvents(runDir) {
  let threadId = null;
  const usage = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0 };
  let text = "";
  try { text = fs.readFileSync(path.join(runDir, "events.jsonl"), "utf8"); } catch { /* 起動失敗 */ }
  for (const line of text.split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "thread.started") threadId = event.thread_id;
    if (event.type === "turn.completed" && event.usage) {
      for (const key of Object.keys(usage)) usage[key] += event.usage[key] || 0;
    }
  }
  return { threadId, usage };
}

// rollout は sessions/YYYY/MM/DD に置かれる。run の開始日と終了日の日付ディレクトリだけを探す
function locateRollout(home, threadId, started) {
  const days = new Set([new Date(started), new Date()].map((d) =>
    path.join(home, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"))));
  for (const dir of days) {
    const found = findRollout(dir, threadId);
    if (found) return found;
  }
  return null;
}

async function run(args) {
  const requestedRoot = path.resolve(args.root ?? ".");
  const root = gitRoot(requestedRoot);
  const task = args.task;
  const step = args.step;
  const allow = (args.allow ?? []).map((a) => a.replace(/^\.\//, ""));
  const home = process.env.CODEX_WORKER_HOME || path.join(os.homedir(), ".codex-worker");
  const timeoutSec = Number(args.timeout ?? DEFAULTS.timeout);
  const maxPacket = Number(args["max-packet"] ?? DEFAULTS.maxPacket);
  const maxAllow = Number(args["max-allow"] ?? DEFAULTS.maxAllow);
  const peakThreshold = Number(args["peak-threshold"] ?? DEFAULTS.peakThreshold);

  const errors = [];
  if (!root) errors.push(`git のリポジトリではない: ${requestedRoot}`);
  if (!/^T\d+$/.test(task ?? "")) errors.push("--task は T<n>");
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
  const allowCheck = root && /^T\d+$/.test(task ?? "") ? checkAllow(root, task, allow, maxAllow) : { errors: [], warnings: [] };
  errors.push(...allowCheck.errors);
  const running = root ? activeWorkerLock(root) : null;
  if (running) errors.push(`別の worker が実行中: ${running.task} ステップ ${running.step}`);
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
  const snapshot = takeSnapshot(root, runDir);
  fs.writeFileSync(path.join(runDir, "run.json"), JSON.stringify({ task, step, model, allow }, null, 2));
  fs.writeFileSync(path.join(runDir, "packet.md"), packet); // verify が検証節を読む
  const { rules, conservative } = selectRules(root, allow);
  const contract = fs.readFileSync(path.join(here, "worker-contract.md"), "utf8");
  const prompt = buildPrompt({ contract, allow, packet, rules });
  fs.writeFileSync(path.join(runDir, "prompt.md"), prompt);

  const status = statusWriter(root, task, step);

  // ロックとシグナル: runner が止められても codex を孤児にせず、ロックを残さない
  const lockFile = workerLockPath(root);
  const lock = { root, task, step, runDir, pid: process.pid, expiresAt: Date.now() + (timeoutSec + 60) * 1000 };
  fs.mkdirSync(path.dirname(lockFile), { recursive: true, mode: 0o700 });
  fs.writeFileSync(lockFile, JSON.stringify(lock));
  let child = null;
  const onSignal = (signal) => {
    if (child) killGroup(child, "SIGKILL");
    fs.rmSync(lockFile, { force: true });
    status(`interrupted by ${signal}(作業ツリーは戻していない)`);
    emit({ accepted: false, stage: "interrupted", run_dir: runDir, reasons: [`runner が ${signal} で止められた。作業ツリーは戻していない(restore --run で戻す)`] }, runDir, 1);
    process.exit(1);
  };
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);

  status(`started model=${model} allow=${allow.join(",")} run=${runDir}`);
  const started = Date.now();
  let exec;
  try {
    exec = await execWorker({
      home, model, root, prompt, runDir, timeoutSec, status,
      onStart: (c) => {
        child = c;
        fs.writeFileSync(lockFile, JSON.stringify({ ...lock, childPid: c.pid }));
      },
    });
  } finally {
    fs.rmSync(lockFile, { force: true });
    for (const signal of signals) process.off(signal, onSignal);
  }
  const durationSec = Math.round((Date.now() - started) / 1000);

  const reasons = [];
  let checked = { changed: [], violations: [], repoChanges: [], ignoredDirs: [] };
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

    checked = gate(snapshot, allow);
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
    const targets = mechanical ? checked.changed.filter((p) => !checked.ignoredDirs.includes(p)) : checked.violations;
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
    model,
    model_family: resolved.family ?? null,
    accepted: reasons.length === 0,
    reasons,
    warnings: [
      ...allowCheck.warnings,
      ...(conservative ? ["許可パスに中身の無いディレクトリがあり、paths 付きの規約も全部付けた"] : []),
      ...(checked.ignoredDirs.length > 0 ? [`.gitignore 対象のディレクトリが出入りした(違反にはしていない): ${checked.ignoredDirs.join(", ")}`] : []),
    ],
    slice_too_large: context.peakRatio !== null && context.peakRatio > peakThreshold,
    worker: result,
    gate: { changed: checked.changed, violations: checked.violations, repo_changes: checked.repoChanges, ignored_dirs: checked.ignoredDirs },
    restore: restoreResult,
    rules: rules.map((r) => r.file),
    metrics: {
      peak_ratio: context.peakRatio,
      context_window: context.contextWindow,
      compacted: context.compacted,
      ...usage,
      duration_s: durationSec,
      packet_bytes: packetBytes,
      prompt_bytes: Buffer.byteLength(prompt),
    },
    rollout: rolloutFile,
  };
  status(renderSummary(report));
  emit(report, runDir, report.accepted ? 0 : 1);
}

// 戻すのはその run の許可パスの中だけ(run の後に監督が書いた状態文書や参照の訂正を巻き込まない)
function restoreRun(args) {
  let snapshot;
  let allow;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(args.run, "snapshot.json"), "utf8"));
    ({ allow } = JSON.parse(fs.readFileSync(path.join(args.run, "run.json"), "utf8")));
  } catch (error) {
    emit({ errors: [`run の記録を読めない: ${args.run ?? "(--run が無い)"}: ${error.message}`] }, null, 2);
    return;
  }
  const keep = (args.keep ?? []).map((a) => a.replace(/^\.\//, ""));
  const within = (p, list) => list.some((a) => isInside(p, a, snapshot.root));
  const targets = changedSince(snapshot).filter((p) => within(p, allow) && !within(p, keep));
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  emit({ restore: restore(snapshot, targets, path.join(args.run, `overwritten-restore-${stamp}`)) }, null, 0);
}

// コマンド 1 本を sh で打つ。出力は全文をログファイルへ、末尾だけを結果へ。タイムアウトはプロセスグループごと止める
function runVerifyCommand(command, root, logFile, timeoutSec) {
  return new Promise((resolve) => {
    const log = fs.openSync(logFile, "w");
    const started = Date.now();
    const child = spawn("/bin/sh", ["-c", command], { cwd: root, stdio: ["ignore", log, log], detached: true });
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, "SIGTERM");
      setTimeout(() => killGroup(child, "SIGKILL"), 10_000).unref();
    }, timeoutSec * 1000);
    const finish = (exitCode, signal, spawnError) => {
      clearTimeout(timer);
      fs.closeSync(log);
      const lines = fs.readFileSync(logFile, "utf8").trimEnd().split("\n");
      resolve({
        command,
        exit_code: exitCode,
        ...(signal ? { signal } : {}),
        ...(timedOut ? { timed_out: true } : {}),
        ...(spawnError ? { spawn_error: spawnError } : {}),
        duration_s: Math.round((Date.now() - started) / 1000),
        log: logFile,
        tail: lines.slice(-VERIFY_TAIL_LINES).join("\n"),
      });
    };
    child.on("error", (error) => finish(null, null, error.message));
    child.on("close", (code, signal) => finish(code, signal, null));
  });
}

// 監督が受け入れの前に打つ検証。worker の申告(tests_run)ではなく、この結果を受け入れの根拠にする。
// 結果はファイル経由でなく stdout で返す(以前の出力ファイルを読み違えないため)
async function verifyRun(args) {
  let snapshot;
  let meta;
  let packet;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(args.run, "snapshot.json"), "utf8"));
    meta = JSON.parse(fs.readFileSync(path.join(args.run, "run.json"), "utf8"));
    packet = fs.readFileSync(path.join(args.run, "packet.md"), "utf8");
  } catch (error) {
    emit({ errors: [`run の記録を読めない: ${args.run ?? "(--run が無い)"}: ${error.message}`] }, null, 2);
    return;
  }
  const root = snapshot.root;
  const commands = packetVerifyCommands(packet);
  const errors = [...checkPacketVerify(packet)];
  const running = activeWorkerLock(root);
  if (running) errors.push(`worker が実行中: ${running.task} ステップ ${running.step}(終わってから打つ)`);
  const timeoutSec = Number(args.timeout ?? VERIFY_TIMEOUT_SEC);
  if (!(timeoutSec > 0)) errors.push("--timeout は正の秒数");
  if (errors.length > 0) {
    emit({ run_dir: args.run, errors }, null, 2);
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const logDir = path.join(args.run, `verify-${stamp}`);
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const status = statusWriter(root, meta.task, meta.step);
  const results = [];
  for (const [index, command] of commands.entries()) {
    status(`verify $ ${command}`);
    const result = await runVerifyCommand(command, root, path.join(logDir, `${index + 1}.log`), timeoutSec);
    status(result.exit_code === 0 ? "verify   ✓" : `verify   ✗ exit ${result.exit_code ?? result.signal ?? "?"}${result.timed_out ? "(タイムアウト)" : ""}`);
    results.push(result);
  }
  const failed = results.filter((r) => r.exit_code !== 0).length;
  status(`verify finished: ${results.length - failed}/${results.length} ok`);
  const report = {
    run_dir: args.run, task: meta.task, step: meta.step, root, verified_at: new Date().toISOString(),
    all_passed: failed === 0, passed: results.length - failed, failed, commands: results,
  };
  const text = JSON.stringify(report, null, 2);
  try { fs.writeFileSync(path.join(args.run, "verify.json"), text); } catch { /* stdout には出す */ }
  process.stdout.write(text + "\n");
  process.exitCode = failed === 0 ? 0 : 1;
}

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" }, task: { type: "string" }, step: { type: "string" }, packet: { type: "string" },
      allow: { type: "string", multiple: true }, model: { type: "string" }, "model-family": { type: "string" },
      timeout: { type: "string" }, "max-packet": { type: "string" }, "max-allow": { type: "string" },
      "peak-threshold": { type: "string" }, run: { type: "string" }, keep: { type: "string", multiple: true },
    },
  });
} catch (error) {
  emit({ errors: [error.message] }, null, 2);
}
if (parsed) {
  const command = parsed.positionals[0];
  if (command === "run") await run(parsed.values);
  else if (command === "restore") restoreRun(parsed.values);
  else if (command === "verify") await verifyRun(parsed.values);
  else emit({ errors: ["usage: cli.mjs run ... | cli.mjs restore --run <dir> | cli.mjs verify --run <dir>"] }, null, 2);
}
