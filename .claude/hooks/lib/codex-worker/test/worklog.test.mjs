// 作業記録(worklog.md)の書式: 1 行 1 件の書き出しと読み戻しが往復で一致すること
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { appendWorklog, formatEntry, normalizeStep, parseEntry, readWorklog, worklogPath } from "../worklog.mjs";

test("書き出した行を読み戻すと、種別・ステップ・キー・一覧・本文が元に戻る", () => {
  const line = formatEntry({
    at: "2026-09-23T10:00:00.000Z", kind: "run", step: "2", by: "runner",
    keys: { run: "T7-s2-x", accepted: true, changed: ["src/a b.ts", "src/c,d.ts", "100%.md"], empty: [] },
    text: "accepted:\n 呼び出し元を直す — 2 件",
  });
  assert.equal(line.split("\n").length, 1, "本文の改行は 1 行に畳む");
  const entry = parseEntry(line);
  assert.equal(entry.at, "2026-09-23T10:00:00.000Z");
  assert.equal(entry.kind, "run");
  assert.equal(entry.step, "s2");
  assert.equal(entry.by, "runner");
  assert.equal(entry.keys.accepted, "true");
  assert.deepEqual(entry.keys.changed, ["src/a b.ts", "src/c,d.ts", "100%.md"]);
  assert.equal(entry.keys.empty, "");
  assert.equal(entry.text, "accepted: 呼び出し元を直す — 2 件");
});

test("本文に key=value や — があっても、キーの並びは最初の — までで終わる", () => {
  const entry = parseEntry(formatEntry({ kind: "fact", text: "a=b — c=d" }));
  assert.deepEqual(entry.keys, {});
  assert.equal(entry.text, "a=b — c=d");
});

test("見出し・空行・手書きの行は読み飛ばし、ステップ番号は s<番号> にそろえる", () => {
  for (const line of ["# T7 worklog — /x", "", "メモ", "- 2026 kind= — 空の種別"]) assert.equal(parseEntry(line), null, line);
  assert.equal(normalizeStep("3"), "s3");
  assert.equal(normalizeStep("s3"), "s3");
  assert.equal(normalizeStep(undefined), null);
});

test("appendWorklog は見出しを 1 回だけ書いて追記し、readWorklog は無ければ null", () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "worklog-"));
  const saved = process.env.XDG_STATE_HOME;
  process.env.XDG_STATE_HOME = base;
  try {
    assert.equal(readWorklog("/repo", "T7"), null);
    appendWorklog("/repo", "T7", { kind: "fact", step: "1", text: "一つ目" });
    appendWorklog("/repo", "T7", { kind: "intent", step: "2", text: "二つ目" });
    const text = fs.readFileSync(worklogPath("/repo", "T7"), "utf8");
    assert.equal(text.match(/^# T7 worklog/gm).length, 1);
    assert.deepEqual(readWorklog("/repo", "T7").entries.map((e) => [e.kind, e.step, e.text]), [["fact", "s1", "一つ目"], ["intent", "s2", "二つ目"]]);
  } finally {
    if (saved === undefined) delete process.env.XDG_STATE_HOME;
    else process.env.XDG_STATE_HOME = saved;
    fs.rmSync(base, { recursive: true, force: true });
  }
});
