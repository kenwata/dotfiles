// 連続実行ループの判定: タスク列の解析、T の状態と依存、checkpoint 以後の完了数、コミットの有無、判定表
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { parseDependencies, readTaskScope } from "../../../check-task-scope.mjs";
import {
  committedSince, completedSinceCheckpoint, dirtyPaths, findTask, handoffSignals, headOf, judge, openDependencies, parseTaskList,
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
  assert.equal(reason({ budgetStage: 2, handoff: { ...base.handoff, amend: true } }).reason, "hole_recorded");
  assert.equal(reason({ handoff: { ...base.handoff, gateQuestion: true } }).reason, "gate_question");
  assert.equal(reason({ sessionChanged: true }).reason, "session_changed");
  assert.equal(reason({ state: "-" }).reason, "task_closed");
  assert.equal(reason({}).reason, "not_completed");
});

test("HANDOFF の /elaborate docs/design/… は再計画への差し戻しとして読む", () => {
  const t = fixture();
  try {
    fs.writeFileSync(path.join(t.root, "HANDOFF.md"), "- 次の一手: /elaborate docs/design/x.md(穴の記録: 目的が変わる)\n");
    assert.equal(handoffSignals(t.root, "T5").elaborate, true);
    assert.equal(judge({ state: " ", committed: false, dirty: [], sessionChanged: false, compacted: false, budgetStage: 2, handoff: handoffSignals(t.root, "T5"), retries: 0, retryMax: 2 }).reason, "hole_recorded");
  } finally { t.cleanup(); }
});
