// worker の環境検査、起動、イベントと rollout の読み取りを担う。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn, execFileSync } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import {
  SANDBOX_PREFIX, SANDBOX_PROBE_SCRIPT, findRollout, resolveModelFamily, sandboxProbeErrors,
} from "./core.mjs";
import { renderEvent } from "./status.mjs";
import { stampReceivedAt } from "./timing.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULTS = { timeout: 1200, maxPacket: 12 * 1024, maxAllow: 3, peakThreshold: 0.6, family: "luna" };
const PROBE_TIMEOUT_MS = 30_000;

export function workerHomeErrors(home) {
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

export function workerHome() {
  return process.env.CODEX_WORKER_HOME || path.join(os.homedir(), ".codex-worker");
}

// worker と verify が打つ sandbox で疎通を実測する。設定の読み違いや Codex の更新で loopback が塞がる・外部が開くと、
// 試験が必ず落ちる・本物の API に届くので、その状態では worker も verify も起動しない
export function sandboxErrors(home, root) {
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
export function privateUvCache(name) {
  const dir = path.join(os.tmpdir(), "claude-codex-worker-uv", name);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  return dir;
}

export function resolveModel(args, home) {
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

export function runId(task, step) {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..*/, "");
  return `${task}-s${step}-${stamp}-${process.pid}`;
}

// codex を独立したプロセスグループで起動し、止める時はグループごと止める(codex が起動したシェルの子も含む)
export function killGroup(child, signal) {
  try { process.kill(-child.pid, signal); } catch { /* 既に終了 */ }
}

// イベントは行単位で保存し、JSON オブジェクト行には受信時刻を加え、それ以外の行はそのまま書く
export function execWorker({ home, model, root, prompt, runDir, timeoutSec, uvCache, onStart, status }) {
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

export function readEvents(runDir) {
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
export function locateRollout(home, threadId, started) {
  const days = new Set([new Date(started), new Date()].map((d) =>
    path.join(home, "sessions", String(d.getFullYear()), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0"))));
  for (const dir of days) {
    const found = findRollout(dir, threadId);
    if (found) return found;
  }
  return null;
}
