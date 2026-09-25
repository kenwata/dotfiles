// run ディレクトリに対する監督の restore と verify を実行する。

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { lockRoot } from "../git.mjs";
import { activeWorkerLock, isInside } from "../../../check-task-scope.mjs";
import {
  SANDBOX_PREFIX, changedSince, checkPacketVerify, packetVerifyCommands, restore,
} from "../core.mjs";
import { readPlan } from "../worklog.mjs";
import { emit, recordWorklog, statusWriter, stepLabel } from "../output.mjs";
import { killGroup, privateUvCache, sandboxErrors, workerHome } from "../worker.mjs";

export const VERIFY_TIMEOUT_SEC = 900;
export const VERIFY_TAIL_LINES = 30;

// 戻すのはその run の許可パスの中だけ(run の後に監督が書いた状態文書や参照の訂正を巻き込まない)
export function restoreRun(args) {
  let snapshot;
  let allow;
  try {
    snapshot = JSON.parse(fs.readFileSync(path.join(args.run, "snapshot.json"), "utf8"));
    ({ allow } = JSON.parse(fs.readFileSync(path.join(args.run, "run.json"), "utf8")));
  } catch (error) {
    emit({ errors: [`run の記録を読めない: ${args.run ?? "(--run が無い)"}: ${error.message}`] }, null, 2);
    return;
  }
  if (!fs.existsSync(snapshot.root) || !fs.statSync(snapshot.root).isDirectory()) {
    emit({ errors: [`作業場所がもう無い: ${snapshot.root}`] }, null, 2);
    return;
  }
  const keep = (args.keep ?? []).map((a) => a.replace(/^\.\//, ""));
  const within = (p, list) => list.some((a) => isInside(p, a, snapshot.root));
  const targets = changedSince(snapshot).filter((p) => within(p, allow) && !within(p, keep));
  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  emit({ restore: restore(snapshot, targets, path.join(args.run, `overwritten-restore-${stamp}`)) }, null, 0);
}

// コマンド 1 本を worker と同じ sandbox の中の sh で打つ。出力は全文をログファイルへ、末尾だけを結果へ。
// タイムアウトはプロセスグループごと止める
export function runVerifyCommand(command, { root, home, uvCache, logFile, timeoutSec }) {
  return new Promise((resolve) => {
    const log = fs.openSync(logFile, "w");
    const started = Date.now();
    const child = spawn("codex", [...SANDBOX_PREFIX, "/bin/sh", "-c", command], {
      cwd: root, env: { ...process.env, CODEX_HOME: home, UV_CACHE_DIR: uvCache }, stdio: ["ignore", log, log], detached: true,
    });
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
export async function verifyRun(args) {
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
  // snapshot.root は作業場所(コマンドを打つ場所)、meta.root は帳簿(状態行・計画・作業記録)の root
  const workspace = snapshot.root;
  if (!fs.existsSync(workspace) || !fs.statSync(workspace).isDirectory()) {
    emit({ run_dir: args.run, errors: [`作業場所がもう無い: ${workspace}`] }, null, 2);
    return;
  }
  const root = meta.root ?? workspace;
  const commands = packetVerifyCommands(packet);
  const errors = [...checkPacketVerify(packet)];
  const running = activeWorkerLock(lockRoot(workspace));
  if (running) errors.push(`worker が実行中: ${running.task} ステップ ${running.step}(終わってから打つ)`);
  const timeoutSec = Number(args.timeout ?? VERIFY_TIMEOUT_SEC);
  if (!(timeoutSec > 0)) errors.push("--timeout は正の秒数");
  const home = workerHome();
  if (errors.length === 0) errors.push(...sandboxErrors(home, workspace));
  if (errors.length > 0) {
    emit({ run_dir: args.run, errors }, null, 2);
    return;
  }

  const stamp = new Date().toISOString().replace(/[-:.]/g, "");
  const logDir = path.join(args.run, `verify-${stamp}`);
  fs.mkdirSync(logDir, { recursive: true, mode: 0o700 });
  const status = statusWriter(root, meta.task, stepLabel(readPlan(root, meta.task), meta.step));
  const results = [];
  const uvCache = privateUvCache(`${path.basename(args.run)}-verify-${stamp}`);
  try {
    for (const [index, command] of commands.entries()) {
      status(`verify $ ${command}`);
      const logFile = path.join(logDir, `${index + 1}.log`);
      const options = { root: workspace, home, uvCache, logFile, timeoutSec };
      const result = await runVerifyCommand(command, options);
      status(result.exit_code === 0 ? "verify   ✓" : `verify   ✗ exit ${result.exit_code ?? result.signal ?? "?"}${result.timed_out ? "(タイムアウト)" : ""}`);
      results.push(result);
    }
  } finally {
    fs.rmSync(uvCache, { recursive: true, force: true });
  }
  const failed = results.filter((r) => r.exit_code !== 0).length;
  status(`verify finished: ${results.length - failed}/${results.length} ok`);
  const report = {
    run_dir: args.run, task: meta.task, step: meta.step, root, workspace,
    verified_at: new Date().toISOString(),
    all_passed: failed === 0, passed: results.length - failed, failed, commands: results,
  };
  const text = JSON.stringify(report, null, 2);
  try { fs.writeFileSync(path.join(args.run, "verify.json"), text); } catch { /* stdout には出す */ }
  recordWorklog(root, meta.task, {
    kind: "verify", step: meta.step, by: "runner",
    keys: { run: path.basename(args.run), result: failed === 0 ? "ok" : `fail:${failed}` },
    text: `${results.length - failed}/${results.length} ok`,
  });
  process.stdout.write(text + "\n");
  process.exitCode = failed === 0 ? 0 : 1;
}
