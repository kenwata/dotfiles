// codex-worker の cli の試験: events.jsonl の受信時刻と run の実行時間の内訳(metrics)。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  setup,
  baseArgs,
  wsArgs,
} from "./cli-harness.mjs";

test("events.jsonl は行を保持して受信時刻を付け、run は command metrics を集計する", () => {
  const t = setup();
  try {
    const runStartedAt = Date.now();
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "timing" });
    const runEndedAt = Date.now();
    assert.equal(code, 0, JSON.stringify(json));

    const expected = [
      "", "not-json",
      JSON.stringify({
        type: "item.started",
        item: {
          id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "check-1", type: "command_execution", command: "/bin/zsh -lc 'uv run pytest -q'",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "other-1", type: "command_execution", command: "sed -n 1p README.md" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "other-1", type: "command_execution", command: "sed -n 1p README.md",
          exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.started",
        item: { id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "packet-1", type: "command_execution", command: "test -f src/a/impl.ts",
          exit_code: 0,
        },
      }),
      JSON.stringify({ type: "message", text: "多バイト文字 é" }),
      JSON.stringify({
        type: "item.started",
        item: { type: "command_execution", command: "/bin/zsh -lc 'npm test'" },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "command_execution", command: "/bin/zsh -lc 'npm test'", exit_code: 0,
        },
      }),
      JSON.stringify({
        type: "item.completed",
        item: {
          type: "file_change",
          changes: [{ path: path.join(t.root, "src/a/impl.ts"), kind: "add" }],
        },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 5 },
      }),
    ];
    const actual = fs.readFileSync(path.join(json.run_dir, "events.jsonl"), "utf8").split("\n");
    assert.equal(actual.length, expected.length + 2);
    assert.match(actual[0], /^\{"received_at":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",/);
    assert.ok(actual[0].includes('"type":"thread.started"'));
    for (const line of actual.filter((entry) => entry.startsWith('{"received_at":'))) {
      const receivedAt = Date.parse(JSON.parse(line).received_at);
      assert.ok(receivedAt >= runStartedAt && receivedAt <= runEndedAt, line);
    }
    for (const [index, line] of expected.entries()) {
      const actualLine = actual[index + 1];
      if (!line || line === "not-json") {
        assert.equal(actualLine, line);
      } else {
        assert.match(actualLine, /^\{"received_at":"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z",/);
        assert.equal(actualLine.slice(actualLine.indexOf(",") + 1), line.slice(1));
      }
    }

    const { metrics } = json;
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
      "check_by_tool", "other_by_tool",
    ])
      assert.ok(Object.hasOwn(metrics, key), key);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
    ])
      assert.ok(Number.isInteger(metrics[key]), key);
    assert.deepEqual(metrics.check_by_tool, { "npm test": 0, packet: 0, pytest: 0 });
    assert.deepEqual(metrics.other_by_tool, { sed: 0 });
    for (const seconds of [
      ...Object.values(metrics.check_by_tool), ...Object.values(metrics.other_by_tool),
    ])
      assert.ok(Number.isInteger(seconds));
    assert.equal(metrics.check_count, 3);
    assert.equal(metrics.other_command_count, 1);
    const measured = metrics.check_s + metrics.other_command_s + metrics.model_s;
    assert.ok(Math.abs(measured - metrics.duration_s) <= 1);
    assert.ok(Number.isInteger(metrics.runner_s) && metrics.runner_s >= metrics.duration_s);
  } finally { t.cleanup(); }
});

test("チャンク境界の多バイト文字と改行なしの末尾イベントを保つ", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "chunked" });
    const splitEvent = '{"type":"message","text":"é"}';
    const finalEvent = '{"type":"message","text":"末尾"}';
    const events = fs.readFileSync(path.join(json.run_dir, "events.jsonl"), "utf8");
    const actualLines = events.split("\n");

    assert.equal(actualLines.length, 3);
    assert.match(actualLines[1], /^\{"received_at":"\d{4}-\d\d-\d\dT/);
    assert.match(actualLines[2], /^\{"received_at":"\d{4}-\d\d-\d\dT/);
    assert.equal(actualLines[1].slice(actualLines[1].indexOf(",") + 1), splitEvent.slice(1));
    assert.equal(actualLines[2].slice(actualLines[2].indexOf(",") + 1), finalEvent.slice(1));
    assert.doesNotThrow(() => JSON.parse(actualLines[1]));
    assert.doesNotThrow(() => JSON.parse(actualLines[2]));
    assert.equal(events.endsWith(actualLines[2]), true);
  } finally { t.cleanup(); }
});

test("時間切れの run も metrics の全キーを出し model_s は 0 以上", () => {
  const t = setup();
  try {
    const { code, json } = t.run(
      [...baseArgs(t.root, t.packet), "--timeout", "1"],
      { FAKE_MODE: "timing-timeout" },
    );
    assert.equal(code, 1);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
      "check_by_tool", "other_by_tool",
    ])
      assert.ok(Object.hasOwn(json.metrics, key), key);
    for (const key of [
      "check_s", "other_command_s", "model_s", "check_count", "other_command_count",
    ])
      assert.ok(Number.isInteger(json.metrics[key]), key);
    assert.ok(json.metrics.check_by_tool && typeof json.metrics.check_by_tool === "object");
    assert.ok(json.metrics.other_by_tool && typeof json.metrics.other_by_tool === "object");
    assert.ok(json.metrics.model_s >= 0);
    assert.equal(json.metrics.check_count, 1);
    const measured = json.metrics.check_s + json.metrics.other_command_s + json.metrics.model_s;
    assert.ok(Math.abs(measured - json.metrics.duration_s) <= 1);
    assert.ok(Number.isInteger(json.metrics.runner_s));
    assert.ok(json.metrics.runner_s >= json.metrics.duration_s);
  } finally { t.cleanup(); }
});

test(
  "run --worktree は同じ本体の accepted run に branch が無ければ拒否する",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      fs.mkdirSync(path.join(t.ws, "src/a"), { recursive: true });
      const legacy = t.run(wsArgs(t), { FAKE_MODE: "ok" });
      assert.equal(legacy.code, 0, JSON.stringify(legacy.json));
      assert.equal(legacy.json.accepted, true);

      const sandboxCallsBefore = t.sandboxCalls().length;
      const workerEnvBefore = t.execEnv();
      const attempted = t.run([...wsArgs(t), "--worktree"], { FAKE_MODE: "ok" });

      assert.equal(attempted.code, 2);
      assert.match(attempted.json.errors.join("\n"), /branch なし accepted run がある/);
      assert.equal(
        t.sandboxCalls().length,
        sandboxCallsBefore,
        "拒否時は worker を起動しない",
      );
      assert.deepEqual(t.execEnv(), workerEnvBefore);
      assert.equal(fs.existsSync(path.join(t.taskDir, "worktree.json")), false);
    } finally { t.cleanup(); }
  },
);

test(
  "worktree.json がある本体リポジトリで --worktree 無しの run を拒否する",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const createArgs = [...baseArgs(t.root, t.packet)];
      createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
      createArgs.push("--workspace", t.ws, "--worktree");
      const created = t.run(createArgs, { FAKE_MODE: "ok" });
      assert.equal(created.code, 2);
      assert.match(created.json.errors.join("\n"), /T の対象の外/);
      assert.equal(
        t.execEnv(),
        null,
        "作業場所の検査拒否より前に worker を起動しない",
      );
      assert.ok(
        fs.existsSync(path.join(t.taskDir, "worktree.json")),
        "検査拒否後も作成した記録を残す",
      );

      const sandboxCallsBefore = t.sandboxCalls().length;
      const withoutWorktree = t.run(wsArgs(t), { FAKE_MODE: "ok" });

      assert.equal(withoutWorktree.code, 2);
      assert.match(
        withoutWorktree.json.errors.join("\n"),
        /worktree.json の本体リポジトリ/,
      );
      assert.equal(
        t.sandboxCalls().length,
        sandboxCallsBefore,
        "拒否時は worker を起動しない",
      );
      assert.equal(t.execEnv(), null);
    } finally { t.cleanup(); }
  },
);

test(
  "削除済み repo の記録では本体外から --worktree 無しで run できる",
  () => {
    const t = setup({ workspace: "repo" });
    try {
      const createArgs = [...baseArgs(t.root, t.packet)];
      createArgs.splice(createArgs.indexOf("--allow"), 2, "--allow", "other/y.ts");
      createArgs.push("--workspace", t.ws, "--worktree");
      const created = t.run(createArgs, { FAKE_MODE: "ok" });
      assert.equal(created.code, 2);
      assert.ok(fs.existsSync(path.join(t.taskDir, "worktree.json")));

      const missingRepo = path.join(t.base, "deleted-repo");
      const recordPath = path.join(t.taskDir, "worktree.json");
      const record = JSON.parse(fs.readFileSync(recordPath, "utf8"));
      fs.writeFileSync(recordPath, JSON.stringify({ ...record, repo: missingRepo }, null, 2));
      assert.equal(fs.existsSync(missingRepo), false);

      const result = t.run(wsArgs(t), { FAKE_MODE: "ok" });

      assert.equal(result.code, 0, JSON.stringify(result.json));
      assert.equal(result.json.accepted, true);
      assert.doesNotMatch(
        result.json.errors?.join("\n") ?? "",
        /worktree\.json の本体リポジトリ/,
      );
    } finally { t.cleanup(); }
  },
);
