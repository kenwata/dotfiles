// show の差し戻し集計と effort 表示を、worklog の run 行だけで固定する。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { formatEntry } from "../worklog.mjs";
import { setup } from "./cli-harness.mjs";

/** Append a synthetic run record without creating a runs/ directory entry. */
function appendRun(t, step, run, keys = {}) {
  const line = formatEntry({
    at: new Date("2026-09-25T00:00:00.000Z"),
    kind: "run",
    step,
    by: "runner",
    keys: { run, accepted: "true", worker: "done", changed: [], ...keys },
    text: "recorded run",
  });
  fs.appendFileSync(path.join(t.taskDir, "worklog.md"), `${line}\n`);
}

/** Run show --json and return its decoded response. */
function showJson(t) {
  return t.run(["show", "--root", t.root, "--task", "T7", "--json"]).json;
}

test("show は worklog の run から reruns と superseded を集計する", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { duration: "10", effort: "high" });
    appendRun(t, "s1", "b", { rerun: "defect", duration: "4", effort: "high" });
    appendRun(t, "s1", "c", { rerun: "supervisor", duration: "2" });
    appendRun(t, "s1", "d", { rerun: "replan", duration: "3" });
    appendRun(t, "s2", "e", { rerun: "supervisor", duration: "1", effort: "medium" });

    const shown = showJson(t);

    assert.deepEqual(shown.reruns, {
      runs: 2,
      seconds: 6,
      share: 0.3,
      missing_duration: 0,
      by_kind: {
        defect: { runs: 1, seconds: 4 },
        supervisor: { runs: 1, seconds: 2 },
        spec: { runs: 0, seconds: 0 },
        environment: { runs: 0, seconds: 0 },
        unknown: { runs: 0, seconds: 0 },
      },
      efforts: ["high", "medium"],
    });
    assert.deepEqual(shown.superseded, { runs: 3, seconds: 16, share: 0.8 });
    assert.deepEqual(shown.steps.map((step) => step.effort), [null, "medium"]);
  } finally {
    t.cleanup();
  }
});

test("show は rerun の無い再実行と未知の種別を unknown に数える", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { duration: "5" });
    appendRun(t, "s1", "b", { duration: "3" });
    appendRun(t, "s1", "c", { rerun: "other", duration: "2" });

    const shown = showJson(t);

    assert.equal(shown.reruns.runs, 2);
    assert.equal(shown.reruns.seconds, 5);
    assert.deepEqual(shown.reruns.by_kind.unknown, { runs: 2, seconds: 5 });
  } finally {
    t.cleanup();
  }
});

test("show は期間の無い行や不正な期間を数え、秒数をゼロにする", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { duration: "8" });
    appendRun(t, "s1", "b", { rerun: "defect" });
    appendRun(t, "s2", "c", { duration: "1.5", stage: "interrupted" });

    const shown = showJson(t);

    assert.equal(shown.reruns.missing_duration, 2);
    assert.equal(shown.reruns.seconds, 0);
    assert.equal(shown.superseded.seconds, 8);
  } finally {
    t.cleanup();
  }
});

test("show は使える期間が無い時に share を null にする", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a");
    appendRun(t, "s1", "b", { rerun: "defect" });

    const shown = showJson(t);

    assert.equal(shown.reruns.share, null);
    assert.equal(shown.superseded.share, null);
  } finally {
    t.cleanup();
  }
});

test("show は各ステップの最新 run の effort を返し、run が無ければ null", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { effort: "medium" });
    appendRun(t, "s1", "b", { effort: "high" });

    const shown = showJson(t);

    assert.deepEqual(shown.steps.map((step) => step.effort), ["high", null]);
  } finally {
    t.cleanup();
  }
});

test("show は effort が一種類なら reruns.efforts を省く", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { effort: "high" });
    appendRun(t, "s1", "b", { effort: "high" });

    const shown = showJson(t);

    assert.equal(Object.hasOwn(shown.reruns, "efforts"), false);
  } finally {
    t.cleanup();
  }
});

test("show --json は steps の後に reruns と superseded を返す", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { duration: "1" });

    const shown = showJson(t);

    assert.deepEqual(Object.keys(shown), [
      "task", "root", "plan_file", "steps", "reruns", "superseded",
    ]);
  } finally {
    t.cleanup();
  }
});

test("人向け show は reruns 行を packet の写しの直前に置く", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { duration: "10", effort: "medium" });
    appendRun(t, "s1", "b", { rerun: "defect", duration: "2", effort: "high" });

    const lines = t.show().stdout.trimEnd().split("\n");

    const packetLine =
      `packet の写し: ${t.taskDir}/s<番号>.packet.md(最新)、` +
      "s<番号>-<run_id>.packet.md(run ごと)";
    assert.equal(lines.at(-1), packetLine);
    const rerunsLine =
      "reruns: 1 件 2s (16.7%) / superseded: 1 件 10s / 内訳: defect 1 件 2s, " +
      "supervisor 0 件 0s, spec 0 件 0s, environment 0 件 0s, unknown 0 件 0s " +
      "/ efforts: medium,high";
    assert.equal(lines.at(-2), rerunsLine);
  } finally {
    t.cleanup();
  }
});

test("作業記録に run が無い show --json は空の集計を返す", () => {
  const t = setup();
  try {
    const shown = showJson(t);

    assert.equal(shown.reruns.runs, 0);
    assert.equal(shown.reruns.share, null);
    assert.deepEqual(shown.superseded, { runs: 0, seconds: 0, share: null });
  } finally {
    t.cleanup();
  }
});

test("reruns 表示は混在 effort と null share を短く表す", () => {
  const t = setup();
  try {
    appendRun(t, "s1", "a", { effort: "medium" });
    appendRun(t, "s1", "b", { effort: "high" });

    const output = t.show().stdout;

    assert.match(output, /reruns: 1 件 0s \(-\) \/ superseded: 1 件 0s/);
    assert.match(output, /efforts: medium,high/);
  } finally {
    t.cleanup();
  }
});
