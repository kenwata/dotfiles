// run の差し戻し判定、記録、packet の run 別保存を確かめる。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PLAN,
  VERIFY_SECTION,
  baseArgs,
  setup,
  waitFor,
  worklogEntries,
} from "./cli-harness.mjs";

const REWORK_SECTION = `## 直すこと
種別: defect
既存テストとの整合: test/cli-rerun.test.mjs の動作確認。根拠は差し戻し要件`;

/** Adds a required valid rework section to the shared packet fixture. */
function reworkPacket() {
  return `## 目的
impl を直す

${REWORK_SECTION}

## 利用者に見える文
該当なし: 試験用

## 横断の確認
該当なし: 試験用

${VERIFY_SECTION}`;
}

/** Records one successful run so the next invocation is treated as a rework. */
function recordFirstRun(t) {
  const first = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
  assert.equal(first.code, 0, JSON.stringify(first.json));

  return t.execEnv();
}

test("差し戻し節の不足や形式違反は起動前に拒否する", () => {
  const packets = [
    ["節が無い", `## 目的
impl

## 横断の確認
該当なし: 試験用

${VERIFY_SECTION}`],
    ["1 行目の書式", reworkPacket().replace("種別: defect", "種別 defect")],
    ["種別が 5 値の外", reworkPacket().replace("種別: defect", "種別: other")],
    [
      "2 行目の書式",
      reworkPacket().replace(/^既存テストとの整合:.+\n/m, "根拠なし\n"),
    ],
  ];

  for (const [issue, packet] of packets) {
    const t = setup();
    try {
      const previousEnv = recordFirstRun(t);
      fs.writeFileSync(t.packet, packet);

      const result = t.run(baseArgs(t.root, t.packet));

      assert.equal(result.code, 2, issue);
      assert.match(result.json.errors.join(), /「## 直すこと」節/);
      assert.match(result.json.errors.join(), /1 行目は.*2 行目は/);
      assert.match(result.json.errors.join(), /種別の意味は defect = worker の欠陥/);
      assert.equal(worklogEntries(t, "run").length, 1, "拒否された run は記録しない");
      assert.deepEqual(t.execEnv(), previousEnv, "worker を起動しない");
    } finally { t.cleanup(); }
  }
});

test("正しい差し戻し節は worklog と report に種別を記録する", () => {
  const t = setup();
  try {
    recordFirstRun(t);
    fs.writeFileSync(t.packet, reworkPacket());

    const result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.rerun_kind, "defect");
    assert.match(worklogEntries(t, "run")[1], /rerun=defect/);
  } finally { t.cleanup(); }
});

test("最初の run は差し戻し節があっても種別を記録しない", () => {
  const t = setup();
  try {
    fs.writeFileSync(t.packet, reworkPacket());

    const result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.rerun_kind, null);
    assert.doesNotMatch(worklogEntries(t, "run")[0], /rerun=/);
  } finally { t.cleanup(); }
});

test("plan の登録し直しを挟んでも同じステップの run は差し戻し", () => {
  const t = setup();
  try {
    recordFirstRun(t);
    assert.equal(t.registerPlan(PLAN).code, 0);
    fs.writeFileSync(t.packet, reworkPacket());

    const result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });

    assert.equal(result.code, 0, JSON.stringify(result.json));
    assert.equal(result.json.rerun_kind, "defect");
    assert.match(worklogEntries(t, "run")[1], /rerun=defect/);
  } finally { t.cleanup(); }
});

test("--step が無い run は利用者に見える文の理由を返さない", () => {
  const t = setup();
  try {
    const packet = fs.readFileSync(t.packet, "utf8").replace(
      /## 利用者に見える文[\s\S]*?(?=## 横断の確認)/,
      "",
    );
    fs.writeFileSync(t.packet, packet);
    const args = baseArgs(t.root, t.packet).filter((arg) => arg !== "--step" && arg !== "1");

    const result = t.run(args);

    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /--step が無い/);
    assert.doesNotMatch(result.json.errors.join(), /利用者に見える文/);
  } finally { t.cleanup(); }
});

test("signal で止まった差し戻し run も種別を記録する", async () => {
  const t = setup();
  const pidFile = path.join(t.base, "grandchild.pid");
  try {
    recordFirstRun(t);
    fs.writeFileSync(t.packet, reworkPacket());
    const child = t.spawnRun(baseArgs(t.root, t.packet), {
      FAKE_MODE: "sleep",
      FAKE_PID_FILE: pidFile,
    });
    await waitFor(() => t.locks().length > 0 && fs.existsSync(pidFile));

    child.kill("SIGTERM");
    await new Promise((resolve) => child.on("close", resolve));

    const runEntry = worklogEntries(t, "run")[1];
    assert.match(runEntry, /rerun=defect/);
    const runId = / run=(\S+)/.exec(runEntry)?.[1];
    assert.ok(runId);
    const reportPath = path.join(
      t.base,
      "state",
      "claude-codex-worker",
      "runs",
      runId,
      "report.json",
    );
    assert.equal(JSON.parse(fs.readFileSync(reportPath, "utf8")).rerun_kind, "defect");
  } finally { t.cleanup(); }
});

test("2 回の run ごとに packet を残し、最新写しは2回目で置き換える", () => {
  const t = setup();
  try {
    const firstPacket = fs.readFileSync(t.packet, "utf8");

    const first = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });

    assert.equal(first.code, 0, JSON.stringify(first.json));

    fs.writeFileSync(t.packet, reworkPacket());
    const secondPacket = fs.readFileSync(t.packet, "utf8");

    const second = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });

    assert.equal(second.code, 0, JSON.stringify(second.json));

    const firstCopy = path.join(t.taskDir, `s1-${first.json.run_id}.packet.md`);
    const secondCopy = path.join(t.taskDir, `s1-${second.json.run_id}.packet.md`);
    assert.equal(fs.readFileSync(firstCopy, "utf8"), firstPacket);
    assert.equal(fs.readFileSync(secondCopy, "utf8"), secondPacket);
    assert.equal(fs.readFileSync(path.join(t.taskDir, "s1.packet.md"), "utf8"), secondPacket);
    assert.equal(
      fs.readdirSync(t.taskDir).filter((name) => /^s1-.+\.packet\.md$/.test(name)).length,
      2,
    );
  } finally { t.cleanup(); }
});
