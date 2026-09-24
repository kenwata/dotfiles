// @ts-check

import { unwrapCommand } from "./status.mjs";

/** 設計書の順に並べた検査用の道具名。 @type {readonly string[]} */
const CHECK_TOOLS = Object.freeze([
  "ruff",
  "pyright",
  "mypy",
  "pytest",
  "black",
  "isort",
  "flake8",
  "pylint",
  "eslint",
  "prettier",
  "tsc",
  "vitest",
  "jest",
  "node --test",
  "npm test",
  "cargo test",
  "cargo clippy",
  "cargo fmt",
  "go test",
  "go vet",
  "shellcheck",
  "markdownlint",
  "bats",
]);

/** 検査前に取り除く実行器の接頭辞。 @type {readonly (readonly string[])[]} */
const EXECUTOR_PREFIXES = Object.freeze([
  ["uv", "run", "--frozen"],
  ["uv", "run"],
  ["uvx"],
  ["poetry", "run"],
  ["pipx", "run"],
  ["npx"],
  ["pnpm", "exec"],
  ["yarn"],
  ["python", "-m"],
  ["python3", "-m"],
]);

/** 展開後に空となったコマンドに使う道具名。 */
const EMPTY_TOOL = "(empty)";

/**
 * 引用符やコマンド置換の中の区切り記号を無視して、
 * シェルコマンドを分割する。
 * @param {string} command 展開済みのコマンド文字列。
 * @returns {string[]} 元の順序を保ったトップレベルのコマンド部分。
 */
function splitCommandParts(command) {
  /** @type {string[]} */
  const parts = [];
  let partStart = 0;
  /** @type {string | null} */
  let quote = null;
  /** @type {Array<string | null>} */
  const substitutionQuotes = [];
  let escaped = false;

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote !== "'" && character === "$" && command[index + 1] === "(") {
      substitutionQuotes.push(quote);
      quote = null;
      index += 1;
      continue;
    }
    if (quote !== null) {
      if (character === quote) quote = null;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (character === ")" && substitutionQuotes.length > 0) {
      quote = substitutionQuotes.pop() ?? null;
      continue;
    }
    if (substitutionQuotes.length > 0) continue;

    const next = command[index + 1];
    if (character === ";" || character === "|") {
      parts.push(command.slice(partStart, index).trim());
      if ((character === ";" || character === "|") && next === character) index += 1;
      partStart = index + 1;
    } else if (character === "&" && next === "&") {
      parts.push(command.slice(partStart, index).trim());
      index += 1;
      partStart = index + 1;
    }
  }

  parts.push(command.slice(partStart).trim());

  return parts;
}

/**
 * コマンド部分の先頭にある認識済み実行器の接頭辞を
 * 繰り返し取り除く。
 * @param {string[]} words 空白で分割したコマンド語。
 * @returns {string[]} 認識済み接頭辞を全て取り除いた語。
 */
function removeExecutorPrefixes(words) {
  let remaining = words;
  let matched = true;

  while (matched) {
    matched = false;
    for (const prefix of EXECUTOR_PREFIXES) {
      if (prefix.every((word, index) => remaining[index] === word)) {
        remaining = remaining.slice(prefix.length);
        matched = true;
        break;
      }
    }
  }

  return remaining;
}

/**
 * 実行器の接頭辞を除いたコマンド部分の先頭にある検査用道具を探す。
 * @param {string} part トップレベルのコマンド部分。
 * @returns {string | null} 一致した検査用道具。見つからない場合は null。
 */
function inspectionTool(part) {
  const initialWords = part.trim().split(/\s+/).filter(Boolean);
  if (initialWords[0] === "cd") return null;

  const words = removeExecutorPrefixes(initialWords);
  const executable = words[0];
  if (!executable) return null;

  const twoWordTool = ["node", "npm", "cargo", "go"].includes(executable)
    ? `${executable} ${words[1] ?? ""}`
    : null;
  const candidate = twoWordTool && CHECK_TOOLS.includes(twoWordTool) ? twoWordTool : executable;

  return CHECK_TOOLS.includes(candidate) ? candidate : null;
}

/**
 * worker のコマンドを認識済みの検査かその他のコマンドに分類する。
 * @param {string} command シェルのラッパーを含む item.command の生文字列。
 * @param {string[]} verifyCommands packet から読み込んだ検証コマンド。
 * @returns {{kind: "check", tool: string} | {kind: "other", tool: string}} 分類結果。
 */
export function classifyCommand(command, verifyCommands) {
  const unwrapped = unwrapCommand(command);
  const parts = splitCommandParts(unwrapped);
  const inspection = parts.map(inspectionTool).find((tool) => tool !== null);
  if (inspection) return { kind: "check", tool: inspection };

  const candidates = [
    unwrapped.trim(),
    ...parts.filter((part) => part.trim() !== "cd" && !/^cd\s/.test(part.trim())),
  ];
  const packetMatch = candidates.some((candidate) =>
    verifyCommands.some((verifyCommand) => candidate === verifyCommand.trim()),
  );
  if (packetMatch) return { kind: "check", tool: "packet" };

  return {
    kind: "other",
    tool: unwrapped.trim().split(/\s+/).filter(Boolean)[0] ?? EMPTY_TOOL,
  };
}

/** @typedef {{ type?: string, item?: {
 * type?: string, id?: string | number, command?: string
 * } }} CodexEvent */
/** @typedef {{ receivedMs: number, event: CodexEvent }} TimedEvent */
/** @typedef {{ startMs: number, endMs: number, command: string }} CommandInterval */
/** @typedef {{ startMs: number, endMs: number }} Interval */
/** @typedef {{ check_s: number, other_command_s: number, model_s: number,
 * check_count: number, other_command_count: number,
 * check_by_tool: Record<string, number>, other_by_tool: Record<string, number> }} TimingSummary */

/**
 * コマンドの開始と完了イベントを対応付け、
 * 未完了のコマンドを endMs で閉じる。
 * @param {TimedEvent[]} timedEvents 受信時刻を伴うイベント。
 * @param {{ endMs: number }} options worker の終了時刻 (ミリ秒)。
 * @returns {CommandInterval[]} 開始イベントの受信順に並んだコマンド区間。
 */
export function pairCommandIntervals(timedEvents, { endMs }) {
  /** @type {Array<{ startMs: number, command: string, id: unknown }>} */
  const pending = [];
  /** @type {CommandInterval[]} */
  const intervals = [];

  for (const { receivedMs, event } of timedEvents) {
    const item = event.item;
    if (!item || item.type !== "command_execution") continue;

    if (event.type === "item.started") {
      pending.push({ startMs: receivedMs, command: item.command ?? "", id: item.id });
      continue;
    }
    if (event.type !== "item.completed") continue;

    const pendingIndex = item.id === undefined
      ? pending.length - 1
      : pending.findLastIndex((entry) => entry.id === item.id);
    if (pendingIndex < 0) continue;

    const [started] = pending.splice(pendingIndex, 1);
    intervals.push({
      startMs: Math.min(started.startMs, endMs),
      endMs: Math.min(receivedMs, endMs),
      command: started.command,
    });
  }

  intervals.push(
    ...pending.map(({ startMs, command }) => ({
      startMs: Math.min(startMs, endMs),
      endMs,
      command,
    })),
  );

  return intervals.sort((left, right) => left.startMs - right.startMs);
}

/**
 * 入力を変更せずに、区間の和集合の長さを返す。
 * @param {Interval[]} intervals ミリ秒単位の区間。
 * @returns {number} 和集合の長さ (ミリ秒)。
 */
export function unionLengthMs(intervals) {
  const sorted = intervals
    .map(({ startMs, endMs }) => ({ startMs, endMs }))
    .sort((left, right) => left.startMs - right.startMs);
  let totalMs = 0;
  let startMs = null;
  let endMs = null;

  for (const interval of sorted) {
    if (startMs === null || endMs === null) {
      startMs = interval.startMs;
      endMs = interval.endMs;
    } else if (interval.startMs <= endMs) {
      endMs = Math.max(endMs, interval.endMs);
    } else {
      totalMs += Math.max(0, endMs - startMs);
      startMs = interval.startMs;
      endMs = interval.endMs;
    }
  }

  return startMs === null || endMs === null
    ? totalMs
    : totalMs + Math.max(0, endMs - startMs);
}

/**
 * worker の時間を検査・その他のコマンド・モデルの時間に集計する。
 * @param {TimedEvent[]} timedEvents 受信時刻を伴うイベント。
 * @param {{ startMs: number, endMs: number, verifyCommands: string[] }} options
 *   worker の時間範囲と packet の検証コマンド。
 * @returns {TimingSummary} 秒単位に丸めた時間、コマンド数、道具別の合計。
 */
export function summarizeTiming(timedEvents, { startMs, endMs, verifyCommands }) {
  const intervals = pairCommandIntervals(timedEvents, { endMs });
  /** @type {Array<Interval & { tool: string }>} */
  const checks = [];
  /** @type {Array<Interval & { tool: string }>} */
  const others = [];

  for (const interval of intervals) {
    const clipped = {
      startMs: Math.max(startMs, Math.min(interval.startMs, endMs)),
      endMs: Math.max(startMs, Math.min(interval.endMs, endMs)),
    };
    const classification = classifyCommand(interval.command, verifyCommands);
    (classification.kind === "check" ? checks : others).push({
      ...clipped,
      tool: classification.tool,
    });
  }

  const checkMs = unionLengthMs(checks);
  const allCommandMs = unionLengthMs([...checks, ...others]);
  const otherMs = allCommandMs - checkMs;
  const durationMs = endMs - startMs;

  return {
    check_s: Math.round(checkMs / 1000),
    other_command_s: Math.round(otherMs / 1000),
    model_s: Math.round(Math.max(0, durationMs - allCommandMs) / 1000),
    check_count: checks.length,
    other_command_count: others.length,
    check_by_tool: roundedToolTotals(checks),
    other_by_tool: roundedToolTotals(others),
  };
}

/**
 * 道具ごとの経過ミリ秒を整数秒に丸める。
 * @param {Array<Interval & { tool: string }>} intervals 分類済みの区間。
 * @returns {Record<string, number>} 道具ごとに丸めた経過秒数。
 */
function roundedToolTotals(intervals) {
  /** @type {Map<string, number>} */
  const totalsMs = new Map();
  for (const { startMs, endMs, tool } of intervals) {
    totalsMs.set(tool, (totalsMs.get(tool) ?? 0) + Math.max(0, endMs - startMs));
  }

  return Object.fromEntries(
    [...totalsMs].map(([tool, elapsedMs]) => [tool, Math.round(elapsedMs / 1000)]),
  );
}
