// codex-worker の cli の試験: 帳簿の側のコマンド(plan・show・note・resume)と作業記録。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  PLAN,
  setup,
  baseArgs,
  assertStatusLogLines,
  readLog,
} from "./cli-harness.mjs";

const REWORK_SECTION = `## 直すこと
種別: defect
既存テストとの整合: 該当なし: 差し戻し契約を満たす試験用 packet`;

/** Adds the required rework section to a packet while preserving its other sections. */
function withReworkSection(packet) {
  return packet.replace(
    "## 利用者に見える文",
    `${REWORK_SECTION}\n\n## 利用者に見える文`,
  );
}

test("plan は計画を登録し、登録し直すと前の計画を残して、一覧を状態行に出す", () => {
  const t = setup();
  try {
    const revised = t.registerPlan("- s1: impl を書く\n- s2: 呼び出し元を直す\n- s3: 文書を直す\n");
    assert.equal(revised.code, 0, JSON.stringify(revised.json));
    assert.equal(revised.json.revised, true);
    assert.deepEqual(revised.json.steps.map((s) => s.step), ["1", "2", "3"]);
    assert.equal(fs.readdirSync(t.taskDir).filter((n) => /^plan-.*\.md$/.test(n)).length, 1, "前の計画が残る");
    const log = fs.readFileSync(t.statusLog, "utf8");
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2} plan registered: 2 steps /m);
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2} plan revised: 3 steps /m);
    assert.match(log, /^\[Codex T7\] \d{2}:\d{2}:\d{2}   s3: 文書を直す$/m);
    assertStatusLogLines(revised.stderr);
    assertStatusLogLines(log);

    for (const bad of ["ステップは後で\n", "- s1: a\n- s1: b\n", "- s1:\n"]) {
      assert.equal(t.registerPlan(bad).code, 2, bad);
    }
    assert.match(fs.readFileSync(path.join(t.taskDir, "plan.md"), "utf8"), /s3: 文書を直す/, "拒否した計画で上書きしない");
  } finally { t.cleanup(); }
});

test("run は計画が無いタスクと計画に無いステップを起動せず、計画があれば全体の何番目かと目的を出す", () => {
  const t = setup();
  try {
    let result = t.run(baseArgs(t.root, t.packet).map((a, i) => (i === 6 ? "3" : a)));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /ステップ 3 が T7 の計画/);
    fs.rmSync(t.taskDir, { recursive: true });
    result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /T7 のステップ計画が無い/);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);

    t.registerPlan(PLAN);
    result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(result.code, 0);
    assert.match(result.stderr, /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} started: impl を書く$/m);
    assert.equal(fs.readFileSync(path.join(t.taskDir, "s1.packet.md"), "utf8"), fs.readFileSync(t.packet, "utf8"));
  } finally { t.cleanup(); }
});

test("show は計画の各ステップの最新の run の状態と verify の結果を並べる", () => {
  const t = setup();
  try {
    let out = t.show();
    assert.equal(out.status, 0);
    assert.match(out.stdout, /^1\/2 s1 +未着手 +impl を書く$/m);

    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    fs.writeFileSync(t.packet, withReworkSection(fs.readFileSync(t.packet, "utf8")));
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]); // 古い run の verify は最新の run の欄に出ない
    out = t.show();
    assert.match(out.stdout, /^1\/2 s1 +accepted\(done\) ×2 +impl を書く$/m);
    assert.match(out.stdout, /^2\/2 s2 +未着手 +呼び出し元を直す$/m);
    assert.ok(out.stdout.includes(path.join(t.taskDir, "plan.md")));

    const latest = fs.readdirSync(path.join(t.base, "state", "claude-codex-worker", "runs")).sort().at(-1);
    t.run(["verify", "--run", path.join(t.base, "state", "claude-codex-worker", "runs", latest)]);
    assert.match(t.show().stdout, /^1\/2 s1 +accepted\(done\) ×2 +verify 1 件失敗 +impl を書く$/m);

    fs.rmSync(t.taskDir, { recursive: true });
    assert.equal(t.show().status, 2);
  } finally { t.cleanup(); }
});

test("show は packet の最新・run ごとの写しを末尾に表示する", () => {
  const t = setup();
  try {
    t.registerPlan(PLAN);

    const out = t.show();

    assert.equal(out.status, 0);
    assert.equal(
      out.stdout.trimEnd().split("\n").at(-1),
      `packet の写し: ${t.taskDir}/s<番号>.packet.md(最新)、s<番号>-<run_id>.packet.md(run ごと)`,
    );
  } finally { t.cleanup(); }
});

test("plan・run・verify は結果を worklog に 1 行ずつ残し、最初の run だけが起動前の未コミットを baseline に持つ", () => {
  const t = setup();
  try {
    fs.appendFileSync(path.join(t.root, "other/y.ts"), "利用者の作業中の変更\n");
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]);
    fs.writeFileSync(t.packet, withReworkSection(fs.readFileSync(t.packet, "utf8")));
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const log = readLog(t);
    assert.match(log, /^- \S+ kind=plan by=runner steps=2 revised=false — s1 impl を書く \/ s2 呼び出し元を直す$/m);
    const runs = log.split("\n").filter((l) => l.includes("kind=run"));
    assert.equal(runs.length, 2);
    assert.match(runs[0], / step=s1 by=runner run=T7-s1-\S+ accepted=true worker=done changed=src\/a\/impl.ts baseline=other\/y.ts — accepted: impl を書く$/);
    assert.doesNotMatch(runs[1], /baseline=/);
    assert.match(log, new RegExp(`kind=verify step=s1 by=runner run=${path.basename(json.run_dir)} result=fail:1 — 1/2 ok`));
  } finally { t.cleanup(); }
});

test("show は run の記録が消えたステップを worklog から出し、--json で同じ内容を返す", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    t.run(["verify", "--run", json.run_dir]);
    fs.rmSync(path.join(t.base, "state", "claude-codex-worker", "runs"), { recursive: true });
    assert.match(t.show().stdout, /^1\/2 s1 +accepted\(done\) +verify 1 件失敗 +impl を書く$/m);
    const shown = t.run(["show", "--root", t.root, "--task", "T7", "--json"]);
    assert.equal(shown.code, 0);
    assert.deepEqual(shown.json.steps.map((s) => [s.step, s.state, s.verify, s.source]), [
      ["1", "accepted(done)", "verify 1 件失敗", "worklog"], ["2", "未着手", "", null],
    ]);
  } finally { t.cleanup(); }
});

test("note は種別と本文を検査して worklog に追記し、--changed auto で未コミットのパスを埋める", () => {
  const t = setup();
  try {
    assert.equal(t.run(["note", "--root", t.root, "--task", "T7", "--kind", "budget", "--text", "x"]).code, 2, "hook の種別は note で書かない");
    assert.equal(t.run(["note", "--root", t.root, "--task", "T7", "--kind", "fact", "--text", " "]).code, 2, "本文が空");
    const fact = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "decision", "--step", "1", "--text", "戻り値は配列にする(呼び出し元 2 か所が反復するため)"]);
    assert.equal(fact.code, 0, JSON.stringify(fact.json));
    fs.writeFileSync(path.join(t.root, "src/a/new.ts"), "x\n");
    const step = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "step", "--step", "s1", "--changed", "auto", "--text", "s1 の検証が通った"]);
    assert.equal(step.code, 0);
    const log = readLog(t);
    assert.match(log, /kind=decision step=s1 by=claude — 戻り値は配列にする\(呼び出し元 2 か所が反復するため\)$/m);
    assert.match(log, /kind=step step=s1 by=claude changed=src\/a\/new.ts — s1 の検証が通った$/m);
    const resume = t.run(["note", "--root", t.root, "--task", "T7", "--kind", "resume", "--from", "2", "--text", "s2 から"], { CODEX_THREAD_ID: "abcdef1234567" });
    assert.match(resume.json.entry, /kind=resume by=codex:abcdef12 from=s2 — s2 から$/);
  } finally { t.cleanup(); }
});

test("resume は作業記録で説明できない未コミットの変更だけを unexplained_dirty に挙げる", () => {
  const t = setup();
  try {
    let resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.equal(resumed.code, 0);
    assert.equal(resumed.json.exists, true, "計画の登録で worklog ができる");
    assert.deepEqual(resumed.json.unexplained_dirty, []);

    fs.appendFileSync(path.join(t.root, "other/y.ts"), "起動前からの変更\n");
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" }); // 受け入れた run の変更 src/a/impl.ts と baseline の other/y.ts
    fs.appendFileSync(path.join(t.root, "TODO.md"), "状態文書\n");
    t.run(["note", "--root", t.root, "--task", "T7", "--kind", "handoff", "--step", "2", "--text", "s2 の途中で予算停止"]);
    resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.dirty.sort(), ["TODO.md", "other/y.ts", "src/a/impl.ts"]);
    assert.deepEqual(resumed.json.unexplained_dirty, []);
    assert.equal(resumed.json.last_handoff.text, "s2 の途中で予算停止");
    assert.equal(resumed.json.steps[0].state, "accepted(done)");

    fs.writeFileSync(path.join(t.root, "src/a/stray.ts"), "誰の変更か分からない\n");
    resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, ["src/a/stray.ts"]);

    t.run(["note", "--root", t.root, "--task", "T7", "--kind", "step", "--step", "2", "--changed", "src/a/stray.ts", "--text", "s2 で足した"]);
    assert.deepEqual(t.run(["resume", "--root", t.root, "--task", "T7"]).json.unexplained_dirty, []);
  } finally { t.cleanup(); }
});

test("不採用の run の変更は説明に使わない", () => {
  const t = setup();
  try {
    t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "violate" }); // 許可外だけ戻し、許可内の impl.ts は残る(不採用)
    const resumed = t.run(["resume", "--root", t.root, "--task", "T7"]);
    assert.deepEqual(resumed.json.unexplained_dirty, ["src/a/impl.ts"]);
  } finally { t.cleanup(); }
});
