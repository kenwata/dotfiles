#!/usr/bin/env node
// Claude Code の /execute-task が、実装ステップ 1 つを Codex worker(codex exec)へ委譲するための runner。
// 監督の手順の正は ~/.claude/templates/codex-worker.md。
//
// 呼び出し規約:
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs plan --root <プロジェクトルート> --task T<n> --file <plan.md>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs show --root <プロジェクトルート> --task T<n> [--json]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs note --root <プロジェクトルート> --task T<n>
//        --kind <fact|decision|rejected|intent|step|handoff|resume> --text <本文 1 行>
//        [--step <番号>] [--from <番号>(resume)] [--changed auto | --changed <パス,パス>]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs resume --root <プロジェクトルート> --task T<n>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs run --root <プロジェクトルート> --task T<n> --step <番号>
//        --packet <packet.md> --allow <パス> [--allow <パス> ...(既定で 3 件まで)]
//        [--workspace <リポジトリ>]
//        [--model-family <luna|terra|sol ...> | --model <モデル ID>] [--timeout <秒>]
//        [--max-packet <バイト>] [--max-allow <件数>] [--peak-threshold <0〜1>]
//   --workspace は worker が書くリポジトリ(既定は --root)。T の対象がプロジェクトの外の
//   リポジトリ(dotfiles など)にある時に使う。--root は帳簿(TODO.md・ステップ計画・作業記録・
//   状態行)の場所のまま、worker の起動(codex exec -C)・snapshot・ゲート・restore・ロック・verify は
//   作業場所で行う。--allow は作業場所からの相対で書き、T の対象の `~/…` と絶対パスは作業場所の中へ
//   読み替えて照合する。規約は作業場所 → --root の順に選ぶ
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
// 実行中の別 worker、sandbox の疎通 = loopback は通り外部は拒否、モデルの解決)→ snapshot → ロック
// (check-task-scope.mjs が Claude 側の編集を止める)→ codex exec(独立したプロセスグループ。タイムアウトとシグナルで
// グループごと止める。UV_CACHE_DIR は TMPDIR の下の run 専用のディレクトリで、終わったら消す)→ ロック解除 →
// rollout からピーク使用率と compaction → ゲート → 必要なら restore(上書き前に現在の内容を退避)→ report。
//
// 出力規約: どの経路でも JSON を 1 つ stdout に出す(run は <run ディレクトリ>/report.json にも保存)。
//   exit 0 = accepted(機構上の失敗なし。worker の status が blocked / failed でも監督の判断材料として有効)
//   exit 1 = 不採用(reasons に理由。restore.restored は snapshot 時点へ戻したパス、restore.unrestorable は
//            自動では戻せなかったパス、restore.backups は上書き前の内容の退避先)
//   exit 2 = 起動前に拒否、または引数・記録の誤り(worker を起動していない / 何も変更していない)
// restore は、監督が accepted の結果を採らないと決めた時に、そのステップの許可パスの中の変更を snapshot 時点へ
// 戻す(許可パスの外は触らない)。--keep を渡すと、そのパスの中の変更は残す。
// plan は、タスクのステップ計画(「- s<番号>: <目的>」の箇条書き)を
// ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/tasks/<ルートのパスの記号を - にした名前>/T<n>/plan.md に登録する。
// 登録し直すと前の計画は plan-<時刻>.md に残る。run は計画に無いステップを起動せず、packet を同じ場所の
// s<番号>.packet.md にも写す。show は計画の各ステップの最新の run の状態と verify の結果を人向けの表で出す。
// verify は、run の packet の「## 検証」節のコマンドを worker と同じ sandbox(`codex sandbox`、worker 用 CODEX_HOME の
// 設定)の中で 1 本ずつ別々に打ち、コマンドごとの終了コードを JSON で stdout と <run ディレクトリ>/verify.json に出す。
// worker が書いたコードを、API キーとネットワークのある sandbox の外で走らせないため。UV_CACHE_DIR は verify 専用。
//   exit 0 = 全部 0、exit 1 = 0 でないものがある、exit 2 = 記録の誤り・worker の実行中・sandbox の疎通の不一致
//   (何も打っていない)
// 作業記録(worklog.md、書式の正は worklog.mjs): plan / run / verify は結果をタスクの置き場の worklog.md にも 1 行ずつ
// 追記する(run の記録は 7 日で消えるが、worklog は消えない)。note は監督(Codex ホストでは本人)がステップの境目の
// 結論を追記する。resume は同じ T の再開の照合を JSON で返す: 計画の各ステップの状態、最後の handoff、
// 作業記録で説明できない未コミットの変更(unexplained_dirty。空でなければ再開せず止まる)。show は runs/ が
// 消えたステップを worklog から埋める。--json で同じ内容を JSON で出す。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { parseArgs } from "node:util";
import { StringDecoder } from "node:string_decoder";
import {
  ALWAYS_ALLOWED, activeWorkerLock, canonical, isInside, workerLockPath,
} from "../../check-task-scope.mjs";
import {
  SANDBOX_PREFIX, SANDBOX_PROBE_SCRIPT, buildPrompt, changedSince, checkAllow, checkPacketCrossCheck, checkPacketVerify, findRollout, packetVerifyCommands, parsePlan, gate,
  readRollout, resolveModelFamily, restore, sandboxProbeErrors, selectRules, takeSnapshot, trackedPaths, validateResult,
  normalizeAllow, workspaceErrors,
} from "./core.mjs";
import { renderEvent, renderSummary } from "./status.mjs";
import { stampReceivedAt, timingMetrics } from "./timing.mjs";
import { NOTE_KINDS, appendWorklog, normalizeStep, readPlan, readWorklog, rootSlug, runsDir, stateDir, taskDir } from "./worklog.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULTS = { timeout: 1200, maxPacket: 12 * 1024, maxAllow: 3, peakThreshold: 0.6, family: "luna" };
const RUN_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const STATUS_LOG_MAX = 1024 * 1024;
const VERIFY_TIMEOUT_SEC = 900;
const VERIFY_TAIL_LINES = 30;
const PROBE_TIMEOUT_MS = 30_000;

function emit(report, runDir, code) {
  const text = JSON.stringify(report, null, 2);
  if (runDir) {
    try { fs.writeFileSync(path.join(runDir, "report.json"), text); } catch { /* stdout には出す */ }
  }
  process.stdout.write(text + "\n");
  process.exitCode = code;
}

// 状態行のプロジェクトごとのログ
function statusLogPath(root) {
  return path.join(stateDir(), "status", `${rootSlug(root)}.log`);
}

// 状態行の前置きのステップ表記。計画があれば全体の何番目かを添える
function stepLabel(plan, step) {
  const index = plan ? plan.steps.findIndex((s) => s.step === step) : -1;
  return index === -1 ? `s${step}` : `s${step} ${index + 1}/${plan.steps.length}`;
}

// 状態行の出力先。stderr(Claude Code のバックグラウンドタスクの表示・手で起動した端末)と、
// 別の端末から `tail -F` で追えるプロジェクトごとのログ。表示の失敗で run を止めない
function statusWriter(root, task, label) {
  const logFile = statusLogPath(root);
  try { fs.mkdirSync(path.dirname(logFile), { recursive: true, mode: 0o700 }); } catch { /* 表示のみ */ }
  try {
    if (fs.statSync(logFile).size > STATUS_LOG_MAX) fs.truncateSync(logFile, 0);
  } catch { /* 初回 */ }
  const prefix = label ? `[Codex ${task} ${label}]` : `[Codex ${task}]`;
  return (text) => {
    if (!text) return;
    const out = text.split("\n").map((line) => `${prefix} ${line}\n`).join("");
    try { process.stderr.write(out); } catch { /* 表示のみ */ }
    try { fs.appendFileSync(logFile, out); } catch { /* 表示のみ */ }
  };
}

// 作業記録への追記は run・verify・plan の成否を左右しない(書けなくても本来の出力は出す)
function recordWorklog(root, task, entry) {
  try { appendWorklog(root, task, entry); } catch { /* 記録のみ */ }
}

// 未コミットの変更(.gitignore 対象を除く)
function dirtyWorktree(root) {
  return trackedPaths(root).filter((e) => !e.ignored).map((e) => e.path);
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

// 実行中ロックの単位。作業場所を含む git リポジトリの最上位にする。作業場所はリポジトリの中の
// サブディレクトリでもよいので、作業場所そのものを単位にすると、範囲の重なる 2 つの worker(同じ
// リポジトリの別のサブディレクトリや最上位)が同時に走り、互いの変更をゲートの違反として巻き戻す
function lockRoot(workspace) {
  return gitRoot(workspace) ?? workspace;
}

function workerHome() {
  return process.env.CODEX_WORKER_HOME || path.join(os.homedir(), ".codex-worker");
}

// worker と verify が打つ sandbox で疎通を実測する。設定の読み違いや Codex の更新で loopback が塞がる・外部が開くと、
// 試験が必ず落ちる・本物の API に届くので、その状態では worker も verify も起動しない
function sandboxErrors(home, root) {
  let output;
  try {
    output = execFileSync("codex", [...SANDBOX_PREFIX, process.execPath, "-e", SANDBOX_PROBE_SCRIPT], {
      cwd: root, encoding: "utf8", env: { ...process.env, CODEX_HOME: home }, stdio: ["ignore", "pipe", "pipe"], timeout: PROBE_TIMEOUT_MS,
    });
  } catch (error) {
    return [`worker の sandbox の疎通を検査できない(codex sandbox): ${error.message.split("\n")[0]}`];
  }
  return sandboxProbeErrors(output);
}

// uv のキャッシュは run(または verify)ごとに TMPDIR の下へ分ける。既定の ~/.cache/uv は sandbox から書けず、
// 書けるようにすると worker が汚した共有キャッシュを sandbox の外の uv が使うことになる
function privateUvCache(name) {
  const dir = path.join(os.tmpdir(), "claude-codex-worker-uv", name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
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

// イベントは行単位で保存し、JSON オブジェクト行には受信時刻を加え、それ以外の行はそのまま書く
function execWorker({ home, model, root, prompt, runDir, timeoutSec, uvCache, onStart, status }) {
  return new Promise((resolve) => {
    const events = fs.openSync(path.join(runDir, "events.jsonl"), "w");
    const stderr = fs.openSync(path.join(runDir, "stderr.txt"), "w");
    const timedEvents = [];
    let eventsClosed = false;
    let pending = "";
    let pendingReceivedMs = Date.now();
    const closeEvents = () => {
      if (eventsClosed) return;
      fs.closeSync(events);
      eventsClosed = true;
    };
    const processLine = (line, receivedMs, terminated = true) => {
      const newline = terminated ? "\n" : "";
      let event;
      try { event = JSON.parse(line); } catch (error) {
        if (error instanceof SyntaxError) {
          fs.writeSync(events, stampReceivedAt(line, receivedMs) + newline);
          return;
        }
        throw error;
      }
      fs.writeSync(events, stampReceivedAt(line, receivedMs) + newline);
      if (typeof event === "object" && event !== null && !Array.isArray(event)) {
        timedEvents.push({ receivedMs, event });
      }
      status(renderEvent(event, { root }));
    };
    const processText = (text, receivedMs) => {
      const lines = `${pending}${text}`.split("\n");
      pending = lines.pop() ?? "";
      pendingReceivedMs = receivedMs;
      for (const line of lines) processLine(line, receivedMs);
    };
    const child = spawn("codex", [
      "exec", "--json", "-s", "workspace-write", "-m", model, "-C", root,
      "--output-schema", path.join(here, "worker-result.schema.json"),
      "-o", path.join(runDir, "result.json"), "-",
    ], { env: { ...process.env, CODEX_HOME: home, UV_CACHE_DIR: uvCache }, stdio: ["pipe", "pipe", stderr], detached: true });
    const decoder = new StringDecoder("utf8"); // チャンク境界で割れた多バイト文字を持ち越す
    child.stdout.on("data", (chunk) => {
      processText(decoder.write(chunk), Date.now());
    });
    child.stdout.on("end", () => {
      processText(decoder.end(), pendingReceivedMs);
      if (pending) processLine(pending, pendingReceivedMs, false);
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
    child.on("error", (error) => {
      clearTimeout(timer);
      closeEvents();
      resolve({ code: null, timedOut, spawnError: error.message, timedEvents });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      killGroup(child, "SIGKILL"); // codex 本体が終わった後に残った子を止める(gate の後に書き込ませない)
      closeEvents();
      resolve({ code, timedOut, timedEvents });
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
  const requestedAllow = (args.allow ?? []).map((a) => a.replace(/^\.\//, ""));
  // 作業場所はリポジトリの中のサブディレクトリでもよい(最上位へ引き上げない)。symlink は実体パスへ
  // 解決する
  const workspace = args.workspace ? canonical(path.resolve(args.workspace)) : root;
  // 作業記録に残す作業場所(root と同じなら無し)
  const loggedWorkspace = workspace === root ? null : workspace;
  const home = workerHome();
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
  const workspaceProblems = root && args.workspace ? workspaceErrors(root, workspace) : [];
  errors.push(...workspaceProblems);
  const normalized = root && workspaceProblems.length === 0
    ? normalizeAllow(requestedAllow, { workspace })
    : { allow: requestedAllow, errors: [] };
  errors.push(...normalized.errors);
  const allow = normalized.allow;
  const allowCheck = root && /^T\d+$/.test(task ?? "") && workspaceProblems.length === 0
    ? checkAllow(root, task, allow, maxAllow, { workspace })
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
  const snapshot = takeSnapshot(workspace, runDir);
  const runMeta = { root, workspace, task, step, model, allow };
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
      },
      text: `runner が ${signal} で止められた。作業ツリーは戻していない`,
    });
    emit({ accepted: false, stage: "interrupted", run_dir: runDir, reasons: [`runner が ${signal} で止められた。作業ツリーは戻していない(restore --run で戻す)`] }, runDir, 1);
    process.exit(1);
  };
  const signals = ["SIGTERM", "SIGINT", "SIGHUP"];
  for (const signal of signals) process.on(signal, onSignal);

  status(`started: ${plan.steps.find((s) => s.step === step).purpose}`);
  const workspaceLabel = workspace === root ? "" : ` workspace=${workspace}`;
  status(`model=${model} allow=${allow.join(",")}${workspaceLabel} run=${runDir}`);
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
      ...(firstRun ? { baseline: Object.entries(snapshot.files).filter(([, f]) => !f.ignored).map(([p]) => p) } : {}),
    },
    text: report.accepted ? `accepted: ${plan.steps.find((s) => s.step === step).purpose}` : reasons.join(" / "),
  });
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

// コマンド 1 本を worker と同じ sandbox の中の sh で打つ。出力は全文をログファイルへ、末尾だけを結果へ。
// タイムアウトはプロセスグループごと止める
function runVerifyCommand(command, { root, home, uvCache, logFile, timeoutSec }) {
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
  // snapshot.root は作業場所(コマンドを打つ場所)、meta.root は帳簿(状態行・計画・作業記録)の root
  const workspace = snapshot.root;
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

// ステップ計画を登録する。切り直した時も同じコマンドで登録し直す(前の計画は残す)
function registerPlan(args) {
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
function stepStates(root, task, plan) {
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

// 計画の各ステップについて、最新の run の状態と verify の結果を人向けの表(--json なら JSON)で出す
function showTask(args) {
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
  const states = stepStates(root, task, plan);
  if (args.json) {
    emit({ task, root, plan_file: plan.file, steps: states }, null, 0);
    return;
  }
  const rows = states.map((s) => [`${s.index}/${s.total} s${s.step}`, s.runs > 1 ? `${s.state} ×${s.runs}` : s.state, s.verify, s.purpose]);
  const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => [...r[i]].length)));
  const pad = (text, width) => text + " ".repeat(width - [...text].length);
  const lines = [`${task} ${root}`, `計画: ${plan.file}`, ""];
  for (const r of rows) lines.push(`${pad(r[0], widths[0])}  ${pad(r[1], widths[1])}  ${pad(r[2], widths[2])}  ${r[3]}`);
  lines.push("", `packet の写し: ${path.dirname(plan.file)}/s<番号>.packet.md`);
  process.stdout.write(lines.join("\n") + "\n");
}

// 監督(Codex ホストでは本人)がステップの境目の結論を worklog に 1 行書く
function noteTask(args) {
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

// run の行の作業場所。帳簿の root で動いた run は null
function runWorkspace(entry) {
  return entry.kind === "run" ? entry.keys.workspace ?? null : null;
}

// 作業記録で説明できるパス(workspace が null なら帳簿の root の、そうでなければその作業場所の):
// 最初の run の前から未コミットだったパス・受け入れた run の変更・Codex ホストが step で
// 記録した変更(step は root のみ)
function explainedPaths(entries, workspace) {
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
function workspaceDirt(entries, workspace) {
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

// 同じ T の再開の照合。未コミットの変更が、作業記録で説明できるもの(最初の run の前から未コミットだったパス・
// 受け入れた run の変更・Codex ホストが step で記録した変更・状態文書)だけかを確かめる
function resumeTask(args) {
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
  const workspaces = workspaceNames.map((workspace) => workspaceDirt(entries, workspace));
  // 作業場所の説明できない変更は絶対パスで足す(空でなければ再開しない、という読み手の規則を
  // 変えないため)
  const unexplainedInWorkspaces = workspaces
    .flatMap((w) => (w.error
      ? [`${w.workspace}(${w.error})`]
      : w.unexplained_dirty.map((p) => path.join(w.workspace, p))));

  const last = (kind) => entries.filter((e) => e.kind === kind).at(-1) ?? null;
  const lock = activeWorkerLock(root);
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
  }, null, 0);
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
      file: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, from: { type: "string" },
      changed: { type: "string" }, json: { type: "boolean" }, workspace: { type: "string" },
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
  else if (command === "plan") registerPlan(parsed.values);
  else if (command === "show") showTask(parsed.values);
  else if (command === "note") noteTask(parsed.values);
  else if (command === "resume") resumeTask(parsed.values);
  else emit({ errors: ["usage: cli.mjs plan ... | cli.mjs run ... | cli.mjs show ... [--json] | cli.mjs note ... | cli.mjs resume ... | cli.mjs restore --run <dir> | cli.mjs verify --run <dir>"] }, null, 2);
}
