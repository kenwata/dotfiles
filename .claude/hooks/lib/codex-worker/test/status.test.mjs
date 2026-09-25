// 状態行の描画(status.mjs)を、codex-cli 0.156.0 の codex exec --json で観測した形のイベントで確かめる
import { test } from "node:test";
import assert from "node:assert/strict";
import { lineSplitter, renderEvent, renderSummary, unwrapCommand } from "../status.mjs";
import { formatStatusLines } from "../status.mjs";

const cmd = (type, command, extra = {}) => ({ type, item: { id: "item_1", type: "command_execution", command, ...extra } });

test("シェルの包みと先頭の環境変数の設定を剥がす", () => {
  assert.equal(unwrapCommand(`/bin/zsh -lc "sed -n '1,20p' a.py"`), "sed -n '1,20p' a.py");
  assert.equal(unwrapCommand(`/bin/zsh -lc 'ls tests'`), "ls tests");
  assert.equal(unwrapCommand(`/bin/zsh -lc "python -c 'print(\\"x\\")'"`), `python -c 'print("x")'`);
  assert.equal(unwrapCommand(`/bin/zsh -lc 'export UV_CACHE_DIR=/tmp/c; uv run pytest -q'`), "uv run pytest -q");
  assert.equal(unwrapCommand("npm test"), "npm test");
});

test("コマンドは開始と終了コードを、ファイル変更はルートからの相対パスを出す", () => {
  assert.equal(renderEvent(cmd("item.started", `/bin/zsh -lc 'npm test'`)), "$ npm test");
  assert.equal(renderEvent(cmd("item.completed", `/bin/zsh -lc 'npm test'`, { exit_code: 0 })), "  ✓ npm test");
  assert.equal(renderEvent(cmd("item.completed", `/bin/zsh -lc 'npm test'`, { exit_code: 1 })), "  ✗ exit 1 npm test");
  const change = {
    type: "item.completed",
    item: { type: "file_change", changes: [{ path: "/r/src/a.ts", kind: "update" }, { path: "/r/test/a.test.ts", kind: "add" }] },
  };
  assert.equal(renderEvent(change, { root: "/r" }), "edit: src/a.ts (update)\nedit: test/a.test.ts (add)");
});

test("進捗の一言は 1 行に縮め、最後の結果 JSON は出さない", () => {
  const msg = (text) => ({ type: "item.completed", item: { type: "agent_message", text } });
  assert.equal(renderEvent(msg("対象を確認します。\n次に編集します。")), "» 対象を確認します。 次に編集します。");
  assert.equal(renderEvent(msg('{\n  "status": "done"\n}')), null);
  assert.ok(renderEvent(msg("あ".repeat(300))).length <= 102);
});

test("usage を出し、知らないイベントと開始済みの非コマンドは出さない", () => {
  const usage = { input_tokens: 10, cached_input_tokens: 4, output_tokens: 5, reasoning_output_tokens: 2 };
  assert.equal(renderEvent({ type: "turn.completed", usage }), "tokens: input=10 cached=4 output=5 (reasoning 2)");
  assert.equal(renderEvent({ type: "thread.started", thread_id: "x" }), null);
  assert.equal(renderEvent({ type: "item.started", item: { type: "file_change", changes: [] } }), null);
  assert.equal(renderEvent({ type: "item.completed", item: { type: "something_new" } }), null);
  assert.equal(renderEvent({ type: "turn.failed", error: { message: "boom" } }), "failed: boom");
});

test("判定の要約は、試験の件数を worker の申告として出し、不採用なら理由の先頭を添える", () => {
  const report = {
    accepted: false, reasons: ["許可パスの外を変更した: other/y.ts"], gate: { changed: ["a", "b"] }, metrics: { duration_s: 42 },
    worker: { status: "done", tests_run: [{ command: "t1", exit_code: 0 }, { command: "t2", exit_code: 1 }] },
  };
  assert.equal(renderSummary(report),
    "finished: rejected worker=done changed=2 tests(申告)=1/2 ok 42s\n  reason: 許可パスの外を変更した: other/y.ts");
  assert.equal(renderSummary({ accepted: true, worker: null, gate: { changed: [] }, metrics: {} }),
    "finished: accepted worker=none changed=0 tests(申告)=0/0 ok ?s");
});

test("行の分割は断片をまたいだ行をつなぎ、末尾の改行の無い行も渡す", () => {
  const lines = [];
  const s = lineSplitter((l) => lines.push(l));
  s.push('{"a":');
  s.push('1}\n{"b"');
  s.push(":2}");
  s.end();
  assert.deepEqual(lines, ['{"a":1}', '{"b":2}']);
});

test("状態行は各本文行にローカル時刻を付ける", () => {
  const date = new Date(2026, 8, 24, 20, 3, 45);

  const lines = formatStatusLines("[Codex T7 s1 1/2]", "$ npm test\n✓ done", date);

  assert.equal(
    lines,
    "[Codex T7 s1 1/2] 20:03:45 $ npm test\n" +
      "[Codex T7 s1 1/2] 20:03:45 ✓ done\n",
  );
  assert.ok(lines.split("\n").filter(Boolean).every((line) =>
    /^\[Codex [^\]]*\] \d{2}:\d{2}:\d{2} /.test(line),
  ));
});

test("timing は check_s が数値の場合に finished と reason の間へ出す", () => {
  const report = {
    accepted: false,
    reasons: ["reason"],
    metrics: { check_s: 1.5, other_command_s: 2, model_s: 3 },
  };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s\n" +
      "  timing: check=1.5s other=2s model=3s\n  reason: reason",
  );
});

test("timing を出さない summary は duration_s のみでも従来の出力を保つ", () => {
  const report = { metrics: { duration_s: 42 } };

  assert.equal(renderSummary(report), "finished: rejected worker=none changed=0 tests(申告)=0/0 ok 42s");
});

test("check_s が null の summary は timing を出さず従来の出力を保つ", () => {
  const report = { metrics: { check_s: null, other_command_s: null, model_s: null } };

  assert.equal(renderSummary(report), "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s");
});

test("size_check の違反は timing 行の末尾に size=NG を出す", () => {
  const report = {
    metrics: { check_s: 1.5, other_command_s: 2, model_s: 3 },
    size_check: { ok: false },
  };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s\n" +
      "  timing: check=1.5s other=2s model=3s size=NG",
  );
});

test("size_check の違反は timing 行が無ければ finished 行の末尾に出す", () => {
  const report = { size_check: { ok: false } };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s size=NG",
  );
});

test("model_reasoning_effort は timing 行の model の直後に出す", () => {
  const report = {
    metrics: { check_s: 1, other_command_s: 2, model_s: 3 },
    model_reasoning_effort: "high",
  };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s\n" +
      "  timing: check=1s other=2s model=3s effort=high",
  );
});

test("model_reasoning_effort は timing 行が無ければ finished 行の末尾に出す", () => {
  const report = { model_reasoning_effort: "high" };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s effort=high",
  );
});

test("effort は size=NG より前に出す", () => {
  const timingReport = {
    metrics: { check_s: 1, other_command_s: 2, model_s: 3 },
    model_reasoning_effort: "high",
    size_check: { ok: false },
  };
  const finishedReport = {
    model_reasoning_effort: "high",
    size_check: { ok: false },
  };

  assert.equal(
    renderSummary(timingReport).split("\n")[1],
    "  timing: check=1s other=2s model=3s effort=high size=NG",
  );
  assert.equal(
    renderSummary(finishedReport),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s effort=high size=NG",
  );
});

test("null の model_reasoning_effort は summary に出さない", () => {
  const report = { model_reasoning_effort: null };

  assert.equal(
    renderSummary(report),
    "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s",
  );
});

test("警告だけの size_check は summary に size=NG を出さない", () => {
  const report = { size_check: { ok: true, warnings: ["warning"] } };

  assert.equal(renderSummary(report), "finished: rejected worker=none changed=0 tests(申告)=0/0 ok ?s");
});
