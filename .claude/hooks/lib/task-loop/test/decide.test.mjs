// 連続実行ループの判定: タスク列の解析、T の状態と依存、checkpoint 以後の完了数、コミットの有無、判定表
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseDependencies, readTaskScope } from "../../../check-task-scope.mjs";
import {
  amendCount, amendOutcome, breakdownOutcome, breakdownTarget, committedSince, completedSinceCheckpoint, dirtyPaths, findTask, handoffSignals, headOf, judge, nextStep,
  openDependencies, openTasks, parseTaskList, planSlug,
} from "../decide.mjs";

const TODO = `| # | T | タスク | 実 | 状態 |
| #1-1 | T1 | 基盤 | — | [x] |
| #1-2 | T2 | 廃止した(廃止: 分け方を変えた。→T4) | — | [-] |
| #1-3 | T3 | 廃止した(廃止: 不要) | — | [-] |
| #1-4 | T4 | 置き換え先 | — | [x] |
| #1-5 | T5 | 次 | — | [ ] |
| #1-6 | T6 | 範囲に依存 | — | [ ] |
| #1-7 | T7 | 廃止に依存 | — | [ ] |
| #1-8 | T8 | archive に依存 | — | [ ] |
| #1-9 | T70 | 桁違い | — | [ ] |

**#1-5 / T5** — 完了条件: 対象: \`src/\`。依存: T1、T2(T2 は T4 に置き換え)。
**#1-6 / T6** — 完了条件: 対象: \`src/\`。依存: T4〜T5。
**#1-7 / T7** — 完了条件: 対象: \`src/\`。依存: T3。
**#1-8 / T8** — 完了条件: 対象: \`src/\`。依存: T0、T9。
`;

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
}

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "task-loop-decide-")));
  git(root, "init", "-q");
  fs.writeFileSync(path.join(root, "TODO.md"), TODO);
  fs.mkdirSync(path.join(root, ".claude/archive"), { recursive: true });
  fs.writeFileSync(path.join(root, ".claude/archive/TODO.md"), "| #0-1 | T0 | 古い | — | [x] |\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  const commit = (message) => git(root, "commit", "-q", "--allow-empty", "-m", message);
  return { root, commit, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test("--tasks は範囲・列挙・混在を書かれた順に展開し、誤りを返す", () => {
  assert.deepEqual(parseTaskList("T12..T14,T20, T13").tasks, ["T12", "T13", "T14", "T20"]);
  assert.deepEqual(parseTaskList("T3").tasks, ["T3"]);
  assert.match(parseTaskList("T5..T3").errors.join(), /逆順/);
  assert.match(parseTaskList("12").errors.join(), /T<n>/);
  assert.match(parseTaskList("").errors.join(), /空/);
});

test("依存は括弧の注記を読まず、範囲を展開する。状態・置き換え先は readTaskScope が返す", () => {
  assert.deepEqual(parseDependencies("**#1 / T5** — 完了条件: 対象: `x`。依存: T9、T31。以降"), ["T9", "T31"]);
  assert.deepEqual(parseDependencies("依存: T26〜T28、T9"), ["T26", "T27", "T28", "T9"]);
  assert.deepEqual(parseDependencies("依存: T42、T78(T78・T99 は、`[x]` であるか、計画 #6 の"), ["T42", "T78"]);
  assert.deepEqual(parseDependencies("完了条件: 依存なし"), []);
  const t2 = readTaskScope(TODO, "T2");
  assert.equal(t2.state, "-");
  assert.equal(t2.replacedBy, "T4");
  assert.equal(readTaskScope(TODO, "T3").replacedBy, null);
  assert.deepEqual(readTaskScope(TODO, "T5").deps, ["T1", "T2"]);
  assert.equal(readTaskScope(TODO, "T4").state, "x", "廃止の行の注記 →T4 を T4 の行と取り違えない");
  assert.equal(readTaskScope(TODO, "T7").open, true, "既存の open も残る");
});

test("締まっていない依存: 廃止は置き換え先で読み替え、置き換え先が無ければ止める。archive の完了も数える", () => {
  const t = fixture();
  try {
    assert.deepEqual(openDependencies(t.root, "T5"), []);
    assert.deepEqual(openDependencies(t.root, "T6"), ["T5 が未完了"]);
    assert.deepEqual(openDependencies(t.root, "T7"), ["T3 は廃止で置き換え先が無い"]);
    assert.deepEqual(openDependencies(t.root, "T8"), ["T9 が見つからない"]);
    assert.equal(findTask(t.root, "T0").source, ".claude/archive/TODO.md");
    assert.deepEqual(openDependencies(t.root, "T99"), ["T99 が TODO.md にも archive にも無い"]);
  } finally { t.cleanup(); }
});

test("checkpoint 以後に [x] になった異なる T を数え、amend と未完了と桁違いを数えない", () => {
  const t = fixture();
  try {
    assert.equal(completedSinceCheckpoint(t.root), null, "checkpoint が無ければ判定しない");
    t.commit("chore: 総点検\n\nFollow-Up-Checkpoint: true");
    t.commit("feat: T1 基盤");
    t.commit("fix: T1 追補");
    t.commit("feat: T4 置き換え先");
    t.commit("amend: T0 の設計を直す");
    t.commit("feat: T5 途中(まだ [ ])");
    t.commit("feat: T70 桁違い");
    const since = completedSinceCheckpoint(t.root);
    assert.deepEqual(since.tasks.sort(), ["T1", "T4"]);
    assert.equal(since.count, 2);
  } finally { t.cleanup(); }
});

test("コミットの有無は head 以後の要約を境界付きで見る。作業ツリーの汚れと HANDOFF の合図を読む", () => {
  const t = fixture();
  try {
    const head = headOf(t.root);
    t.commit("feat: T70 桁違い");
    assert.equal(committedSince(t.root, head, "T7"), false);
    t.commit("amend: plan の設計を改訂(T7 由来)");
    assert.equal(committedSince(t.root, head, "T7"), false, "amend のコミットは T の実装ではない");
    t.commit("feat: T7 実装");
    assert.equal(committedSince(t.root, head, "T7"), true);
    assert.deepEqual(dirtyPaths(t.root), []);
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "## 次セッションの最初の一手\n- /amend T7\n- [回収: T8 着手前] どちらにするか\n");
    assert.deepEqual(dirtyPaths(t.root), ["HANDOFF.md"]);
    assert.deepEqual(handoffSignals(t.root, "T7"), { amend: true, elaborate: false, gateQuestion: false });
    assert.deepEqual(handoffSignals(t.root, "T70"), { amend: false, elaborate: false, gateQuestion: false });
    assert.equal(handoffSignals(t.root, "T8").gateQuestion, true);
  } finally { t.cleanup(); }
});

test("判定表: 完了・再送・停止の理由", () => {
  const base = {
    state: " ", committed: false, dirty: [], sessionChanged: false, compacted: false, budgetStage: 0,
    handoff: { amend: false, elaborate: false, gateQuestion: false }, retries: 0, retryMax: 2,
  };
  const reason = (patch) => judge({ ...base, ...patch });
  assert.deepEqual(reason({ state: "x", committed: true }), { action: "next", reason: "completed" });
  assert.equal(reason({ state: "x", committed: true, dirty: ["a"] }).reason, "dirty_after_commit");
  assert.equal(reason({ state: "x" }).reason, "not_committed");
  assert.deepEqual(reason({ budgetStage: 2 }), { action: "retry", reason: "budget_stop" });
  assert.equal(reason({ budgetStage: 1, retries: 2 }).reason, "budget_retry_exhausted");
  assert.equal(reason({ budgetStage: 2, compacted: true }).reason, "compacted", "compact は予算停止より先に止める");
  assert.deepEqual(reason({ budgetStage: 2, handoff: { ...base.handoff, amend: true } }), { action: "amend", reason: "hole_recorded" }, "穴は予算停止より先に /amend へ");
  assert.equal(reason({ handoff: { ...base.handoff, amend: true }, amended: true }).reason, "amend_repeated");
  assert.deepEqual(reason({ handoff: { ...base.handoff, amend: true, elaborate: true } }), { action: "stop", reason: "hole_recorded" }, "/elaborate はループに入れない");
  assert.equal(reason({ handoff: { ...base.handoff, gateQuestion: true } }).reason, "gate_question");
  assert.equal(reason({ sessionChanged: true }).reason, "session_changed");
  assert.equal(reason({ state: "-" }).reason, "task_closed");
  assert.equal(reason({}).reason, "not_completed");
});

test("HANDOFF の /elaborate docs/design/… は再計画への差し戻しとして読む", () => {
  const t = fixture();
  try {
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "## 次セッションの最初の一手\n- /elaborate docs/design/x.md(穴の記録: 目的が変わる)\n");
    assert.equal(handoffSignals(t.root, "T5").elaborate, true);
    assert.equal(judge({ state: " ", committed: false, dirty: [], sessionChanged: false, compacted: false, budgetStage: 2, handoff: handoffSignals(t.root, "T5"), retries: 0, retryMax: 2 }).reason, "hole_recorded");
  } finally { t.cleanup(); }
});

test("openTasks は TODO.md のタスク表で [ ] の T を上から順に返し、計画表の行は数えない", () => {
  const t = fixture();
  try {
    assert.deepEqual(openTasks(t.root), ["T5", "T6", "T7", "T8", "T70"]);
    fs.writeFileSync(path.join(t.root, "TODO.md"), "| #1 | 計画 | docs/design/x.md | [ ] |\n");
    assert.deepEqual(openTasks(t.root), []);
  } finally { t.cleanup(); }
});

test("planSlug は T の行の直前の `## #<n> <slug>` 見出しを返し、見出しの無い T・別の見出しの下の T・無い T は null", () => {
  const t = fixture();
  try {
    assert.equal(planSlug(t.root, "T5"), null, "計画の見出しが無い TODO.md");
    fs.writeFileSync(path.join(t.root, "TODO.md"), [
      "## 計画", "| #1 | alpha-plan | docs/design/alpha-plan.md | [ ] |", "",
      "## #1 alpha-plan", "| #1-1 | T5 | 一つ目 | — | [ ] |", "",
      "## #2 beta-plan", "| #2-1 | T6 | 二つ目 | — | [ ] |", "",
      "## §9 その他", "| x | T7 | 計画の外 | — | [ ] |", "",
    ].join("\n"));
    fs.writeFileSync(path.join(t.root, ".claude/archive/TODO.md"), [
      "# TODO アーカイブ", "", "## Rotated 2026-09-17 (計画 #0 の全タスクが完了)", "", "### 計画", "| #0 | old-plan | — | [x] |", "",
      "### #0 old-plan", "", "| #0-1 | T0 | 古い | — | [x] |", "",
    ].join("\n"));
    assert.equal(planSlug(t.root, "T5"), "alpha-plan");
    assert.equal(planSlug(t.root, "T6"), "beta-plan");
    assert.equal(planSlug(t.root, "T7"), null, "計画ではない見出しの下");
    assert.equal(planSlug(t.root, "T0"), "old-plan", "archive へ移った T も引ける");
    assert.equal(planSlug(t.root, "T99"), null);
  } finally { t.cleanup(); }
});

test("nextStep は「次セッションの最初の一手」節の最初のコマンドだけを読み、説明の続く書き方でも引数を取る", () => {
  const t = fixture();
  const write = (text) => fs.writeFileSync(path.join(t.root, "HANDOFF.md"), text);
  try {
    assert.equal(nextStep(t.root), null, "HANDOFF.md が無い");
    write("## 仕掛かり中\n\n- 穴の記録。次の一手は /amend T5\n\n## 次セッションの最初の一手\n\n- `/execute-task T59`(ワーカーの 2 段記録)。T56〜T58 は後で\n\n## 要確認\n\n- /breakdown docs/design/y.md は別\n");
    assert.deepEqual(nextStep(t.root), { command: "execute-task", arg: "T59" }, "仕掛かり中の /amend も要確認の /breakdown も読まない");
    assert.equal(handoffSignals(t.root, "T5").amend, false, "穴の判定も次の一手の節だけで見る");
    write("## 最後に完了したタスク\n\n- `/amend T54`: T54 の是正タスク T59 を足した\n\n## 次セッションの最初の一手\n\n- `/execute-task T59`(説明)\n");
    assert.equal(handoffSignals(t.root, "T54").amend, false, "済んだ amend の記録を穴と読まない(VC_Analysis の実例)");
    for (const [line, step] of [
      ["- /execute-task T12で再開する", { command: "execute-task", arg: "T12" }],
      ["- /execute-task T12.", { command: "execute-task", arg: "T12" }],
      ["- **/execute-task T12**", { command: "execute-task", arg: "T12" }],
      ["- 「/execute-task　T12」", { command: "execute-task", arg: "T12" }],
      ["- /breakdown docs/design/foo.mdの段階 2", { command: "breakdown", arg: "docs/design/foo.md" }],
    ]) {
      write("## 次セッションの最初の一手\n" + line + "\n");
      assert.deepEqual(nextStep(t.root), step, line);
    }
    write("## 次セッションの最初の一手\n- `/execute-task T20`。未分解の段階が 1 つ残る。T25 の後に `/breakdown docs/design/a.md` を再実行する\n- /breakdown docs/design/a.md\n");
    assert.deepEqual(nextStep(t.root), { command: "execute-task", arg: "T20" }, "最初の行の最初のコマンドを取る(breakdown.md 手順 3 の書き添え)");
    write("## 次セッションの最初の一手\n- /breakdown docs/design/alpha.md(段階 2 の分解)\n");
    assert.deepEqual(nextStep(t.root), { command: "breakdown", arg: "docs/design/alpha.md" });
    assert.equal(breakdownTarget(t.root), "docs/design/alpha.md");
    write("## 次セッションの最初の一手\n- `$amend T7`\n");
    assert.deepEqual(nextStep(t.root), { command: "amend", arg: "T7" }, "Codex の $ も読む");
    assert.equal(breakdownTarget(t.root), null);
    write("## 次セッションの最初の一手\n- TODO.md の T147 に着手する\n");
    assert.equal(nextStep(t.root), null, "コマンドの形で書かれていなければ読まない");
    write("## 次セッションの最初の一手\n- `/breakdown`(引数なし)\n");
    assert.equal(breakdownTarget(t.root), null, "設計書のパスが無い /breakdown は送らない");
  } finally { t.cleanup(); }
});

test("amendOutcome: コミット・計画工程のファイルの着地・次の一手が未着手の T の /execute-task、がそろって done", () => {
  const t = fixture();
  const write = (text) => fs.writeFileSync(path.join(t.root, "HANDOFF.md"), text);
  try {
    write("## 仕掛かり中\n- T5 の穴の記録\n## 次セッションの最初の一手\n- `/amend T5`\n");
    git(t.root, "add", "-A");
    git(t.root, "commit", "-qm", "chore: T5 の穴の記録");
    const head = headOf(t.root);
    fs.writeFileSync(path.join(t.root, "src.txt"), "途中成果物"); // 穴で止まった execute-task の未コミットは妨げない
    fs.mkdirSync(path.join(t.root, "docs/guide"), { recursive: true });
    fs.writeFileSync(path.join(t.root, "docs/guide/x.md"), "書きかけの成果物の文書");
    assert.equal(amendOutcome(t.root, head), "incomplete", "何も起きていない");
    write("## 仕掛かり中\n- なし\n## 次セッションの最初の一手\n- `/execute-task T5`\n");
    assert.equal(amendOutcome(t.root, head), "incomplete", "HANDOFF.md が未コミット");
    git(t.root, "add", "HANDOFF.md");
    git(t.root, "commit", "-qm", "amend: plan の設計を改訂(T5 由来)");
    assert.equal(amendOutcome(t.root, head), "done", "docs/guide/ の書きかけは計画工程のファイルではない");
    fs.mkdirSync(path.join(t.root, "docs/design"), { recursive: true });
    fs.writeFileSync(path.join(t.root, "docs/design/plan.md"), "書きかけ");
    assert.equal(amendOutcome(t.root, head), "incomplete", "設計書が未コミット");
    fs.rmSync(path.join(t.root, "docs/design"), { recursive: true });
    write("## 仕掛かり中\n- T5 の穴の記録\n## 次セッションの最初の一手\n- `/elaborate docs/design/plan.md`\n");
    assert.equal(amendOutcome(t.root, head), "elaborate");
    for (const [step, expected, why] of [
      ["/execute-task T6", "done", "足した是正タスク・次の未着手へ戻るのも着地(VC_Analysis の amend T54 → T59)"],
      ["/execute-task T4", "incomplete", "完了済みの T は戻り先にならない"],
      ["/execute-task T99", "incomplete", "無い T"],
      ["/amend T5", "incomplete", "次の一手がまだ amend"],
    ]) {
      write("## 次セッションの最初の一手\n- `" + step + "`\n");
      git(t.root, "add", "HANDOFF.md");
      git(t.root, "commit", "-qm", "amend: plan の設計を改訂(T5 由来)");
      assert.equal(amendOutcome(t.root, head), expected, why);
    }
  } finally { t.cleanup(); }
});

test("amendCount は T 由来の amend だけを履歴全体から数え、取り下げ・回送と桁違いは数えない", () => {
  const t = fixture();
  try {
    t.commit("amend: plan の設計を改訂(T5 由来)");
    t.commit("amend: T5 の穴の記録を取り下げ(参照の誤りのみ)");
    t.commit("amend: plan の設計を改訂(T50 由来)");
    t.commit("feat: T5 由来の説明を含む別のコミット");
    t.commit("amend: plan の設計を改訂(T5 由来)");
    assert.equal(amendCount(t.root, "T5"), 2);
    assert.equal(amendCount(t.root, "T50"), 1);
  } finally { t.cleanup(); }
});

test("breakdownOutcome: コミットと新しい [ ] の T がそろって done、次の一手が /elaborate なら elaborate", () => {
  const t = fixture();
  try {
    const head = headOf(t.root);
    const before = openTasks(t.root);
    assert.equal(breakdownOutcome(t.root, head, before), "incomplete");
    fs.writeFileSync(path.join(t.root, "TODO.md"), TODO + "| #2-1 | T90 | 次の段階 | — | [ ] |\n");
    assert.equal(breakdownOutcome(t.root, head, before), "incomplete", "TODO.md が未コミット");
    git(t.root, "commit", "-qam", "plan: x の実行計画を策定(T90)");
    assert.equal(breakdownOutcome(t.root, head, before), "done");
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "## 次セッションの最初の一手\n- /elaborate docs/design/x.md\n");
    assert.equal(breakdownOutcome(t.root, head, before), "elaborate");
  } finally { t.cleanup(); }
});
