import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyCommand,
  pairCommandIntervals,
  summarizeTiming,
  stampReceivedAt,
  timingMetrics,
  unionLengthMs,
} from "../timing.mjs";

const checkTools = [
  "ruff", "pyright", "mypy", "pytest", "black", "isort", "flake8", "pylint", "eslint",
  "prettier", "tsc", "vitest", "jest", "node --test", "npm test", "cargo test",
  "cargo clippy", "cargo fmt", "go test", "go vet", "shellcheck", "markdownlint", "bats",
];

/** @param {string} type イベント種別。 @param {string} command コマンド文字列。
 * @param {string} [id] item の識別子。
 */
const cmd = (type, command, id) => ({
  type,
  item: { ...(id === undefined ? {} : { id }), type: "command_execution", command },
});

/**
 * @param {number} receivedMs イベントの受信時刻。
 * @param {object} event codex のイベント。
 */
const timed = (receivedMs, event) => ({ receivedMs, event });

test("JSON オブジェクト行の先頭に受信時刻を追加し後続バイト列を保つ", () => {
  const line = '{ "é":"\\u00e9", "aggregated_output":"\\\\\\\"" }';

  const result = stampReceivedAt(line, Date.parse("2026-09-24T11:03:54.075Z"));

  assert.equal(
    result,
    '{"received_at":"2026-09-24T11:03:54.075Z",' + line.slice(1),
  );
  assert.deepEqual(Object.keys(JSON.parse(result)), [
    "received_at", "é", "aggregated_output",
  ]);
});

test("先頭空白のある JSON オブジェクト行で波括弧と後続バイト列を保つ", () => {
  const line = '  { "é":"\\u00e9" }';
  const objectStart = line.indexOf("{");

  const result = stampReceivedAt(line, 0);

  assert.ok(result.startsWith(line.slice(0, objectStart + 1)));
  assert.ok(result.endsWith(line.slice(objectStart + 1)));
  assert.deepEqual(JSON.parse(result), {
    received_at: "1970-01-01T00:00:00.000Z",
    "é": "é",
  });
});

test("先頭空白と内部空白のある空オブジェクト行を JSON のまま保つ", () => {
  const line = " \t{ }";
  const objectStart = line.indexOf("{");

  const result = stampReceivedAt(line, 0);

  assert.ok(result.startsWith(line.slice(0, objectStart + 1)));
  assert.ok(result.endsWith(line.slice(objectStart + 1)));
  assert.deepEqual(JSON.parse(result), {
    received_at: "1970-01-01T00:00:00.000Z",
  });
});

test("空の JSON オブジェクト行に不正な末尾カンマを付けない", () => {
  const result = stampReceivedAt("{}", 0);

  assert.equal(result, '{"received_at":"1970-01-01T00:00:00.000Z"}');
  assert.doesNotThrow(() => JSON.parse(result));
});

test("JSON オブジェクト以外と壊れた行をそのまま返す", () => {
  for (const line of ["", "not json", "{broken", "[]", "null", "42", '"text"']) {
    assert.equal(stampReceivedAt(line, 0), line);
  }
});

test("集計例外を timing_error に変え秒数を null にする", () => {
  const result = timingMetrics([
    timed(0, cmd("item.started", "custom-check", "check")),
  ], { startMs: 0, endMs: 1000, verifyCommands: /** @type {string[]} */ (null) });

  const { timing_error: timingError, ...metrics } = result;

  assert.deepEqual(metrics, {
    check_s: null,
    other_command_s: null,
    model_s: null,
    check_count: 0,
    other_command_count: 0,
    check_by_tool: {},
    other_by_tool: {},
  });
  assert.equal(typeof timingError, "string");
  assert.ok(timingError.length > 0);
});

test("既知の検査コマンドを前置きが繰り返されても分類する", () => {
  const result = classifyCommand(
    `/bin/zsh -lc 'cd repo && uv run --frozen python -m pytest -q'`,
    [],
  );

  assert.deepEqual(result, { kind: "check", tool: "pytest" });
});

test("コマンド置換の内側にある検査コマンドは分類しない", () => {
  const result = classifyCommand(`test -z "$(uv run pytest -q)"`, []);

  assert.deepEqual(result, { kind: "other", tool: "test" });
});

test("packet の検証コマンドと全文が一致すれば packet 検査に分類する", () => {
  const result = classifyCommand("custom-check --all", ["custom-check --all"]);

  assert.deepEqual(result, { kind: "check", tool: "packet" });
});

test("区切った部分が packet の検証コマンドと一致すれば分類する", () => {
  const result = classifyCommand("cd repo && custom-check --all", ["custom-check --all"]);

  assert.deepEqual(result, { kind: "check", tool: "packet" });
});

test("一覧の検査語を packet 一致より優先する", () => {
  const result = classifyCommand("pytest -q", ["pytest -q"]);

  assert.deepEqual(result, { kind: "check", tool: "pytest" });
});

test("その他は先頭語、空なら空ラベルを返す", () => {
  assert.deepEqual(classifyCommand("A=b echo done", []), {
    kind: "other",
    tool: "echo",
  });
  assert.deepEqual(classifyCommand("", []), { kind: "other", tool: "(empty)" });
});

test("引用符内の区切り記号はコマンドを分割しない", () => {
  const result = classifyCommand(`printf '%s' 'pytest && nope'`, []);

  assert.deepEqual(result, { kind: "other", tool: "printf" });
});

test("指定された検査語を全て検査に分類する", () => {
  for (const tool of checkTools) {
    assert.deepEqual(classifyCommand(tool, []), { kind: "check", tool });
  }
});

test("複合実行語の別サブコマンドはその他に分類する", () => {
  for (const command of ["npm install", "node script.js", "cargo build", "go build"]) {
    assert.equal(classifyCommand(command, []).kind, "other");
  }
});

test("単一引用符内の置換風文字列を無視する", () => {
  assert.deepEqual(classifyCommand("grep '$(' a.txt && pytest -q", []), {
    kind: "check",
    tool: "pytest",
  });
});

test("id による対応付けと id 無しの最新開始の対応付けを行う", () => {
  const intervals = pairCommandIntervals([
    timed(100, cmd("item.started", "pytest -q", "check")),
    timed(200, cmd("item.started", "echo work")),
    timed(300, cmd("item.started", "printf work", "other")),
    timed(500, cmd("item.completed", "", "other")),
    timed(600, cmd("item.completed", "")),
    timed(700, cmd("item.completed", "", "check")),
  ], { endMs: 800 });

  assert.deepEqual(intervals, [
    { startMs: 100, endMs: 700, command: "pytest -q" },
    { startMs: 200, endMs: 600, command: "echo work" },
    { startMs: 300, endMs: 500, command: "printf work" },
  ]);
});

test("未完了の区間を endMs で閉じ、孤立した完了を無視する", () => {
  const intervals = pairCommandIntervals([
    timed(100, cmd("item.completed", "", "missing")),
    timed(200, cmd("item.started", "pytest -q", "check")),
    timed(300, cmd("item.started", "echo work")),
  ], { endMs: 900 });

  assert.deepEqual(intervals, [
    { startMs: 200, endMs: 900, command: "pytest -q" },
    { startMs: 300, endMs: 900, command: "echo work" },
  ]);
});

test("id のない完了は id のある開始にも最新順で対応付ける", () => {
  const intervals = pairCommandIntervals([
    timed(100, cmd("item.started", "echo first", "first")),
    timed(200, cmd("item.started", "echo latest", "latest")),
    timed(300, cmd("item.completed", "")),
  ], { endMs: 400 });

  assert.deepEqual(intervals, [
    { startMs: 100, endMs: 400, command: "echo first" },
    { startMs: 200, endMs: 300, command: "echo latest" },
  ]);
});

test("区間の和集合で重なり・包含・接触・空区間を処理する", () => {
  const intervals = [
    { startMs: 10, endMs: 30 },
    { startMs: 15, endMs: 20 },
    { startMs: 30, endMs: 40 },
    { startMs: 50, endMs: 50 },
  ];
  const original = structuredClone(intervals);

  assert.equal(unionLengthMs(intervals), 30);
  assert.deepEqual(intervals, original);
  assert.equal(unionLengthMs([]), 0);
});

test("検査とその他が重なる時間を検査に寄せて集計する", () => {
  const result = summarizeTiming([
    timed(0, cmd("item.started", "pytest -q", "check")),
    timed(1000, cmd("item.started", "echo work", "other")),
    timed(5000, cmd("item.completed", "", "check")),
    timed(8000, cmd("item.completed", "", "other")),
  ], { startMs: 0, endMs: 10_000, verifyCommands: [] });

  assert.deepEqual(result, {
    check_s: 5,
    other_command_s: 3,
    model_s: 2,
    check_count: 1,
    other_command_count: 1,
    check_by_tool: { pytest: 5 },
    other_by_tool: { echo: 7 },
  });
  assert.ok(Math.abs(
    result.check_s + result.other_command_s + result.model_s - 10,
  ) <= 1);
});

test("端数ミリ秒を含む複数ケースで三区分の和が許容範囲に収まる", () => {
  const cases = [
    {
      endMs: 7000,
      events: [
        timed(1500, cmd("item.started", "pytest -q", "check")),
        timed(2500, cmd("item.started", "echo work", "other")),
        timed(3500, cmd("item.completed", "", "check")),
        timed(4500, cmd("item.completed", "", "other")),
      ],
    },
    {
      endMs: 7000,
      events: [
        timed(1000, cmd("item.started", "pytest -q", "check")),
        timed(4000, cmd("item.started", "echo work", "other")),
        timed(2500, cmd("item.completed", "", "check")),
        timed(5500, cmd("item.completed", "", "other")),
      ],
    },
  ];

  for (const { endMs, events } of cases) {
    const result = summarizeTiming(events, {
      startMs: 0,
      endMs,
      verifyCommands: [],
    });

    assert.ok(Math.abs(
      result.check_s + result.other_command_s + result.model_s - Math.round(endMs / 1000),
    ) <= 1);
  }
});

test("開始境界より前の未完了区間を切り詰める", () => {
  const result = summarizeTiming([
    timed(500, cmd("item.started", "pytest -q", "check")),
    timed(2000, cmd("item.started", "echo work", "other")),
  ], { startMs: 1000, endMs: 4000, verifyCommands: [] });

  assert.ok(result.model_s >= 0);
  assert.ok(result.check_s + result.other_command_s <= Math.round((4000 - 1000) / 1000));
  assert.equal(result.check_count + result.other_command_count, 2);
});

test("packet の検証コマンドとの一致を packet 道具に集計する", () => {
  const result = summarizeTiming([
    timed(0, cmd("item.started", "custom-check --all", "packet")),
    timed(1500, cmd("item.completed", "", "packet")),
  ], {
    startMs: 0,
    endMs: 2000,
    verifyCommands: ["custom-check --all"],
  });

  assert.deepEqual(result.check_by_tool, { packet: 2 });
});
