import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildPrompt, changedSince, checkAllow, checkPacketCrossCheck, checkPacketVerify, gate, packetVerifyCommands, parsePlan, readRollout, resolveModelFamily, restore, sandboxProbeErrors, selectRules,
  normalizeAllow, takeSnapshot, validateResult, workspaceErrors,
} from "../core.mjs";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.email=t@example.com", "-c", "user.name=t", ...args], { encoding: "utf8" });
}

function write(root, file, text) {
  fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
  fs.writeFileSync(path.join(root, file), text);
}

const read = (root, file) => fs.readFileSync(path.join(root, file), "utf8");

// src/a/x.ts・other/y.ts をコミット済み。other/dirty.ts は未コミットの変更、note.txt は untracked
function fixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-test-"));
  const root = path.join(base, "repo");
  fs.mkdirSync(root);
  git(root, "init", "-q");
  write(root, "src/a/x.ts", "x1\n");
  write(root, "other/y.ts", "y1\n");
  write(root, "other/dirty.ts", "d1\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  write(root, "other/dirty.ts", "d2-user\n");
  write(root, "note.txt", "user note\n");
  const runDir = path.join(base, "run");
  return { base, root, runDir, cleanup: () => fs.rmSync(base, { recursive: true, force: true }) };
}

test("許可パス内の変更と新規ファイルはゲートを通る", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const snapshot = takeSnapshot(root, runDir);
    write(root, "src/a/x.ts", "x2\n");
    write(root, "src/a/new.ts", "n\n");
    const result = gate(snapshot, ["src/a/"]);
    assert.deepEqual(result.changed, ["src/a/new.ts", "src/a/x.ts"]);
    assert.equal(result.passed, true);
  } finally { cleanup(); }
});

test("snapshot 前から未コミットのファイルへの追記も、内容の比較で違反として捕まる", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const snapshot = takeSnapshot(root, runDir);
    assert.deepEqual(gate(snapshot, ["src/a/"]).changed, [], "利用者の既存の変更は worker の変更に数えない");
    write(root, "other/dirty.ts", "d2-user\nworker\n");
    const result = gate(snapshot, ["src/a/"]);
    assert.deepEqual(result.violations, ["other/dirty.ts"]);
    assert.equal(result.passed, false);
  } finally { cleanup(); }
});

test("削除と許可外への rename も違反になり、restore で snapshot 時点へ戻る", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const snapshot = takeSnapshot(root, runDir);
    write(root, "src/a/x.ts", "x2\n");
    fs.rmSync(path.join(root, "other/y.ts"));
    fs.renameSync(path.join(root, "note.txt"), path.join(root, "other/note.txt"));
    write(root, "other/dirty.ts", "overwritten\n");
    const result = gate(snapshot, ["src/a/"]);
    assert.deepEqual(result.violations, ["note.txt", "other/dirty.ts", "other/note.txt", "other/y.ts"]);
    const out = restore(snapshot, result.violations, path.join(runDir, "overwritten"));
    assert.deepEqual(out.restored, result.violations);
    assert.equal(read(root, "other/y.ts"), "y1\n");
    assert.equal(read(root, "other/dirty.ts"), "d2-user\n", "未コミットだった内容は退避コピーから戻る");
    assert.equal(read(root, "note.txt"), "user note\n");
    assert.equal(fs.existsSync(path.join(root, "other/note.txt")), false);
    assert.equal(read(root, "src/a/x.ts"), "x2\n", "許可内の変更は残す");
    assert.deepEqual(changedSince(snapshot), ["src/a/x.ts"]);
  } finally { cleanup(); }
});

test("実行権限の変更も捕まり、restore で権限まで戻る", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, "other/run.sh", "echo hi\n");
    fs.chmodSync(path.join(root, "other/run.sh"), 0o755);
    git(root, "add", "other/run.sh");
    git(root, "commit", "-qm", "script");
    const snapshot = takeSnapshot(root, runDir);
    fs.chmodSync(path.join(root, "other/run.sh"), 0o644);
    assert.deepEqual(gate(snapshot, ["src/a/"]).violations, ["other/run.sh"]);
    restore(snapshot, ["other/run.sh"], path.join(runDir, "overwritten"));
    assert.equal(fs.statSync(path.join(root, "other/run.sh")).mode & 0o777, 0o755);
    assert.deepEqual(changedSince(snapshot), []);
  } finally { cleanup(); }
});

test(".gitignore 対象のファイルの変更は違反、ディレクトリの出入りは警告に分ける", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    write(root, ".gitignore", ".env\ncoverage/\n");
    git(root, "add", ".gitignore");
    git(root, "commit", "-qm", "ignore");
    write(root, ".env", "SECRET=1\n");
    const snapshot = takeSnapshot(root, runDir);
    write(root, ".env", "SECRET=2\n");
    write(root, "coverage/out.txt", "x\n");
    const result = gate(snapshot, ["src/a/"]);
    assert.deepEqual(result.violations, [".env"]);
    assert.deepEqual(result.ignoredDirs, ["coverage"]);
    restore(snapshot, result.violations, path.join(runDir, "overwritten"));
    assert.equal(read(root, ".env"), "SECRET=1\n");
  } finally { cleanup(); }
});

test("入れ子のリポジトリの中の変更は捕まるが、restore は消さずに unrestorable として返す", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const nested = path.join(root, "vendor/lib");
    fs.mkdirSync(nested, { recursive: true });
    git(nested, "init", "-q");
    write(nested, "a.txt", "1\n");
    git(nested, "add", "-A");
    git(nested, "commit", "-qm", "n");
    const snapshot = takeSnapshot(root, runDir);
    assert.deepEqual(changedSince(snapshot), []);
    write(nested, "a.txt", "2\n");
    const result = gate(snapshot, ["src/a/"]);
    assert.deepEqual(result.violations, ["vendor/lib"]);
    const out = restore(snapshot, result.violations, path.join(runDir, "overwritten"));
    assert.deepEqual(out.unrestorable, ["vendor/lib"]);
    assert.equal(read(nested, "a.txt"), "2\n", "入れ子のリポジトリは消さない");
  } finally { cleanup(); }
});

test("restore は上書き前の内容を退避する(run 中の利用者の編集を失わない)", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const snapshot = takeSnapshot(root, runDir);
    write(root, "other/dirty.ts", "d2-user\ntyped during run\n");
    const out = restore(snapshot, ["other/dirty.ts"], path.join(runDir, "overwritten"));
    assert.equal(read(root, "other/dirty.ts"), "d2-user\n");
    assert.equal(fs.readFileSync(out.backups["other/dirty.ts"], "utf8"), "d2-user\ntyped during run\n");
  } finally { cleanup(); }
});

test("commit と stage は git の状態の変化として捕まる", () => {
  const { root, runDir, cleanup } = fixture();
  try {
    const snapshot = takeSnapshot(root, runDir);
    write(root, "src/a/x.ts", "x2\n");
    git(root, "add", "src/a/x.ts");
    assert.deepEqual(gate(snapshot, ["src/a/"]).repoChanges, ["index"]);
    git(root, "commit", "-qm", "worker");
    const result = gate(snapshot, ["src/a/"]);
    assert.ok(result.repoChanges.includes("head"));
    assert.ok(result.repoChanges.includes("refs"));
    assert.equal(result.passed, false);
  } finally { cleanup(); }
});

function withTodo(root, block) {
  write(root, "TODO.md", `| #1-1 | T7 | x | 中 | — | [ ] |\n| #1-2 | T8 | y | 中 | — | [x] |\n\n${block}\n**#1-2 / T8** — 完了条件: 対象: \`src/a/\`。\n`);
}

test("許可パスは T の対象の中に限られ、状態文書と設計書は許さない", () => {
  const { root, cleanup } = fixture();
  try {
    withTodo(root, "**#1-1 / T7** — 完了条件: 対象: `src/a/`、`tests/a/`。");
    assert.deepEqual(checkAllow(root, "T7", ["src/a/x.ts", "tests/a/"]).errors, []);
    assert.match(checkAllow(root, "T7", ["other/"]).errors.join(), /T の対象の外: other\//);
    assert.match(checkAllow(root, "T7", ["TODO.md"]).errors.join(), /worker に許さない/);
    assert.match(checkAllow(root, "T7", ["docs/"]).errors.join(), /worker に許さない/, "docs/design/ を含む上位ディレクトリも拒否");
    assert.match(checkAllow(root, "T8", ["src/a/"]).errors.join(), /未完了/);
    assert.match(checkAllow(root, "T7", []).errors.join(), /1 つも無い/);
    assert.match(checkAllow(root, "T7", ["src/a/1", "src/a/2", "src/a/3", "src/a/4"]).errors.join(), /上限 3/);
    assert.deepEqual(checkAllow(root, "T7", ["src/a/1", "src/a/2", "src/a/3", "src/a/4"], 4).errors, []);
  } finally { cleanup(); }
});

test("対象に散文の項目がある T は、対象外の許可パスを警告に落とす", () => {
  const { root, cleanup } = fixture();
  try {
    withTodo(root, "**#1-1 / T7** — 完了条件: 対象: `src/a/`、調整用ケース。");
    const result = checkAllow(root, "T7", ["other/"]);
    assert.deepEqual(result.errors, []);
    assert.match(result.warnings.join(), /散文/);
  } finally { cleanup(); }
});

test("規約は許可パスに当てはまるものと paths の無いものだけを選ぶ", () => {
  const { root, cleanup } = fixture();
  try {
    write(root, ".claude/rules/javascript.md", '---\npaths:\n  - "**/*.ts"\n---\n\n# JS\nuse const\n');
    write(root, ".claude/rules/python.md", '---\npaths:\n  - "**/*.py"\n---\n\n# Py\n');
    write(root, ".claude/rules/testing.md", "---\n---\n\n# Testing\ntest first\n");
    write(root, ".claude/rules/frontend/react.md", '---\npaths:\n  - "src/a/**"\n---\n\n# React\n');
    write(root, ".codex/rules/javascript.md", '---\npaths:\n  - "**/*.ts"\n---\n\n# JS (codex copy)\n');
    const { rules, conservative } = selectRules(root, ["src/a/"]);
    assert.deepEqual(rules.map((r) => r.file), [".claude/rules/frontend/react.md", ".claude/rules/javascript.md", ".claude/rules/testing.md"]);
    assert.equal(conservative, false);
    assert.equal(rules[1].text, "# JS\nuse const", "frontmatter は外して本文だけ渡す");
    assert.deepEqual(selectRules(root, ["other/new.py"]).rules.map((r) => r.file), [".claude/rules/python.md", ".claude/rules/testing.md"]);
    fs.mkdirSync(path.join(root, "src/empty"));
    const empty = selectRules(root, ["src/empty/"]);
    assert.equal(empty.conservative, true);
    assert.equal(empty.rules.length, 4, "照合できないディレクトリでは paths 付きの規約も全部含める");
  } finally { cleanup(); }
});

test("プロンプトは契約・許可パス・packet・規約の順に組み立てる", () => {
  const prompt = buildPrompt({
    contract: "CONTRACT", allow: ["src/a/"], packet: "## 目的\nPACKET", rules: [{ file: ".claude/rules/t.md", text: "RULE" }],
    sizeCheck: { cli: "/runner/cli.mjs", runDir: "/runs/run-1" },
  });
  const order = [
    "CONTRACT", "- `src/a/`", "## 終える前の機械検査", "PACKET",
    "### .claude/rules/t.md", "RULE",
  ].map((s) => prompt.indexOf(s));
  assert.ok(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1])), prompt);
});

test("rollout からピーク使用率と compaction 回数を読む", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "codex-worker-rollout-"));
  try {
    const file = path.join(dir, "rollout.jsonl");
    const count = (t) => JSON.stringify({ type: "event_msg", payload: { type: "token_count", info: { last_token_usage: { total_tokens: t }, model_context_window: 200000 } } });
    fs.writeFileSync(file, [count(20000), count(150000), JSON.stringify({ type: "compacted", payload: {} }), count(30000), "not json", ""].join("\n"));
    assert.deepEqual(readRollout(file), { peakRatio: 0.75, contextWindow: 200000, compacted: 1 });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("最終応答の欠落と不正な status を検出する", () => {
  assert.deepEqual(validateResult(null), ["最終応答が JSON オブジェクトでない"]);
  const ok = { status: "done", changed_files: [], tests_run: [], criteria: [], holes: [], reference_errors: [], notes: "" };
  assert.deepEqual(validateResult(ok), []);
  assert.match(validateResult({ ...ok, status: "maybe" }).join(), /status が不正/);
  const { holes, ...missing } = ok;
  assert.match(validateResult(missing).join(), /holes が無い/);
});

test("モデルの系統名を一覧の最新の版の ID へ解決する(版番号を固定しない)", () => {
  const catalog = { models: [
    { slug: "gpt-6-astra" }, { slug: "gpt-6-sol" }, { slug: "gpt-6-luna" }, { slug: "gpt-5.6-terra" },
    { slug: "gpt-5.6-luna" }, { slug: "gpt-10-luna-mini" }, { slug: "gpt-5.10-sol" },
  ] };
  assert.equal(resolveModelFamily("luna", catalog), "gpt-6-luna");
  assert.equal(resolveModelFamily("terra", catalog), "gpt-5.6-terra");
  assert.equal(resolveModelFamily("Sol", catalog), "gpt-6-sol", "5.10 より 6 が新しい(数値で比べる)");
  assert.equal(resolveModelFamily("nova", catalog), null);
  assert.equal(resolveModelFamily("luna", [{ slug: "gpt-7-luna" }, { slug: "gpt-6-luna" }]), "gpt-7-luna");
});

test("packet に横断の確認の節が無ければ、点検リストを理由にして拒否する", () => {
  const errors = checkPacketCrossCheck("## 目的\nimpl を書く\n");

  assert.equal(errors.length, 1);
  assert.match(errors[0], /## 横断の確認/);
  assert.match(errors[0], /作り手と呼び出し元を検索/);
  assert.match(errors[0], /測って報告するだけ/);
  assert.match(errors[0], /穴の記録の経路/);
});

test("横断の確認の節が空白だけなら拒否し、次の見出しまでに中身があれば通す", () => {
  assert.equal(checkPacketCrossCheck("## 横断の確認\n  \n\n## 入口\n- a.ts\n").length, 1);
  assert.deepEqual(checkPacketCrossCheck("## 横断の確認\n該当なし: 許可パス内で閉じる変更\n## 入口\n- a.ts\n"), []);
  assert.deepEqual(checkPacketCrossCheck("## 目的\nx\n\n## 横断の確認\n- f: 作り手 a.ts:1 / 呼び出し元 b.ts:2\n"), []);
});

test("見出しの深さが違う節や本文中の語は横断の確認の節とみなさない", () => {
  assert.equal(checkPacketCrossCheck("### 横断の確認\n該当なし: x\n").length, 1);
  assert.equal(checkPacketCrossCheck("## 目的\n## 横断の確認 は後で書く\n").length, 1);
});

test("検証節の箇条書きを 1 項目 1 コマンドで読み、バッククォートがあればその中身だけを取る", () => {
  const packet = "## 検証\n- `uv run pytest tests/x -q`(黒箱の試験を含む)\n* ruff check src\n\n本文の行は読まない\n- \n## 入口\n- `a.ts`\n";
  assert.deepEqual(packetVerifyCommands(packet), ["uv run pytest tests/x -q", "ruff check src"]);
  assert.deepEqual(checkPacketVerify(packet), []);
});

test("検証節が無いか、コマンドの箇条書きが無ければ拒否する", () => {
  assert.equal(checkPacketVerify("## 目的\nx\n").length, 1);
  assert.equal(checkPacketVerify("## 検証\n試験を回す\n## 入口\n- a.ts\n").length, 1);
  assert.equal(checkPacketVerify("### 検証\n- `true`\n").length, 1);
  assert.match(checkPacketVerify("")[0], /lint・型検査/);
});

test("ステップ計画は「- s<番号>: <目的>」の行だけを読み、重複・空の目的・ステップ無しを誤りにする", () => {
  assert.deepEqual(parsePlan("# 計画\n\n- s1: 検査を書く\n本文\n* s2a：実装する\n").steps, [
    { step: "1", purpose: "検査を書く" }, { step: "2a", purpose: "実装する" },
  ]);
  assert.match(parsePlan("- s1: a\n- s1: b\n").errors.join(), /2 回/);
  assert.match(parsePlan("- s1:\n").errors.join(), /目的が空/);
  assert.match(parsePlan("計画は後で\n").errors.join(), /1 つも無い/);
});

test("sandboxProbeErrors は loopback が通り外部が拒否された時だけ空を返す", () => {
  assert.deepEqual(sandboxProbeErrors("LOOPBACK=ok\nEXTERNAL=blocked EPERM\n"), []);
  assert.deepEqual(sandboxProbeErrors("LOOPBACK=ok\nEXTERNAL=blocked timeout\n"), []);
  assert.match(sandboxProbeErrors("LOOPBACK=denied EPERM\nEXTERNAL=blocked EPERM\n").join(), /loopback/);
  assert.match(sandboxProbeErrors("LOOPBACK=ok\nEXTERNAL=reached\n").join(), /外部/);
  assert.match(sandboxProbeErrors("").join(), /判定できない/);
  assert.match(sandboxProbeErrors("LOOPBACK=ok\n").join(), /判定できない/);
});

// タスクの帳簿(TODO.md)を持つ root と、worker が書く別のリポジトリ ws。home/.cfg は ws への symlink
// (~/.claude が dotfiles/.claude への symlink である構成を写す)
function workspaceFixture() {
  const { base, root, cleanup } = fixture();
  const ws = path.join(base, "ws");
  fs.mkdirSync(ws);
  git(ws, "init", "-q");

  write(ws, "src/a/x.ts", "x1\n");
  write(ws, "other/y.ts", "y1\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "init");

  const home = path.join(base, "home");
  fs.mkdirSync(home);
  fs.symlinkSync(ws, path.join(home, ".cfg"));

  return { base, root, ws, home, cleanup };
}

test("作業場所を分けると、許可パスを作業場所から読み、対象の ~ と絶対パスを読み替える", () => {
  const { root, ws, home, cleanup } = workspaceFixture();
  try {
    const targets = ["~/.cfg/src/a/", `${ws}/tests/a/`, "src/b/"].map((t) => `\`${t}\``).join("、");
    withTodo(root, `**#1-1 / T7** — 完了条件: 対象: ${targets}。`);
    const errorsFor = (allow) => checkAllow(root, "T7", allow, 3, { workspace: ws, home }).errors;

    assert.deepEqual(errorsFor(["src/a/x.ts", "tests/a/"]), []);
    assert.match(errorsFor(["other/"]).join(), /T の対象の外: other\//);
    const relativeTarget = errorsFor(["src/b/"]).join();
    assert.match(relativeTarget, /T の対象の外: src\/b\//, "相対の対象は帳簿の root の中を指す");
    assert.match(errorsFor(["../repo/src/b/"]).join(), /作業場所の外のパス/);
  } finally { cleanup(); }
});

test("作業場所を分けない時は、~ の対象は root の中を指さない限り許可パスに当たらない", () => {
  const { root, home, cleanup } = workspaceFixture();
  try {
    withTodo(root, "**#1-1 / T7** — 完了条件: 対象: `~/.cfg/src/a/`。");

    const result = checkAllow(root, "T7", ["src/a/x.ts"], 3, { home });

    assert.match(result.errors.join(), /T の対象の外: src\/a\/x\.ts/);
  } finally { cleanup(); }
});

test("作業場所は git のリポジトリで、帳簿の root と入れ子にならない", () => {
  const { base, root, ws, cleanup } = workspaceFixture();
  try {
    assert.deepEqual(workspaceErrors(root, root), []);
    assert.deepEqual(workspaceErrors(root, ws), []);
    assert.match(workspaceErrors(root, path.join(base, "home")).join(), /git のリポジトリではない/);

    fs.mkdirSync(path.join(root, "inner"));
    git(path.join(root, "inner"), "init", "-q");
    assert.match(workspaceErrors(root, path.join(root, "inner")).join(), /入れ子/);
    assert.match(workspaceErrors(path.join(root, "inner"), root).join(), /入れ子/);
  } finally { cleanup(); }
});

test("規約は作業場所のものを先に、帳簿の root のものを後に選び、同じ名前は先を採る", () => {
  const { root, ws, cleanup } = workspaceFixture();
  try {
    write(ws, ".claude/rules/lua.md", '---\npaths:\n  - "**/*.lua"\n---\n\n# Lua\n');
    write(ws, ".claude/rules/testing.md", "---\n---\n\n# Testing (ws)\n");
    write(root, ".claude/rules/testing.md", "---\n---\n\n# Testing (root)\n");
    write(root, ".claude/rules/coding.md", "---\n---\n\n# Coding (root)\n");

    const { rules } = selectRules(ws, ["src/a/x.ts"], [ws, root]);

    const expected = [".claude/rules/testing.md", path.join(root, ".claude/rules/coding.md")];
    assert.deepEqual(rules.map((r) => r.file), expected);
    assert.match(rules[0].text, /# Testing \(ws\)/);
  } finally { cleanup(); }
});

// リポジトリ ws の中のサブディレクトリ pkg を作業場所にする。ws の最上位には、ほかのプロセスが
// 書き続ける .gitignore 対象の live.log と、追跡中の top.ts がある(dotfiles の history.jsonl などを
// 写す)
function subdirFixture() {
  const { base, root, ws, home, cleanup } = workspaceFixture();
  write(ws, ".gitignore", "*.log\n");
  write(ws, "top.ts", "t1\n");
  write(ws, "pkg/src/a/x.ts", "x1\n");
  git(ws, "add", "-A");
  git(ws, "commit", "-qm", "pkg");
  write(ws, "live.log", "line1\n");

  const pkg = path.join(ws, "pkg");
  return { base, root, ws, pkg, home, runDir: path.join(base, "run"), cleanup };
}

test("作業場所がサブディレクトリなら、snapshot とゲートはその中だけを見る", () => {
  const { pkg, ws, runDir, cleanup } = subdirFixture();
  try {
    const snapshot = takeSnapshot(pkg, runDir);
    fs.appendFileSync(path.join(ws, "live.log"), "line2\n");
    write(ws, "top.ts", "t2\n");
    write(pkg, "src/a/x.ts", "x2\n");

    const result = gate(snapshot, ["src/a/"]);

    assert.equal(result.passed, true, JSON.stringify(result));
    assert.deepEqual(result.changed, ["src/a/x.ts"]);
    assert.equal(fs.readFileSync(path.join(ws, "live.log"), "utf8"), "line1\nline2\n");
  } finally { cleanup(); }
});

test("作業場所がサブディレクトリでも、restore はその中を HEAD と snapshot の状態へ戻す", () => {
  const { pkg, runDir, cleanup } = subdirFixture();
  try {
    const snapshot = takeSnapshot(pkg, runDir);
    write(pkg, "src/a/x.ts", "x2\n");
    write(pkg, "src/a/new.ts", "n\n");

    const paths = ["src/a/x.ts", "src/a/new.ts"];
    const result = restore(snapshot, paths, path.join(runDir, "overwritten"));

    assert.deepEqual(result.restored, ["src/a/x.ts", "src/a/new.ts"]);
    assert.equal(fs.readFileSync(path.join(pkg, "src/a/x.ts"), "utf8"), "x1\n");
    assert.equal(fs.existsSync(path.join(pkg, "src/a/new.ts")), false);
  } finally { cleanup(); }
});

test("ignoredFiles: warn のゲートは .gitignore 対象のファイルの変化を別に分ける", () => {
  const { ws, runDir, cleanup } = subdirFixture();
  try {
    const snapshot = takeSnapshot(ws, runDir);
    fs.appendFileSync(path.join(ws, "live.log"), "line2\n");
    write(ws, "new.log", "n\n");

    const warned = gate(snapshot, ["pkg/src/a/"], { ignoredFiles: "warn" });
    const strict = gate(snapshot, ["pkg/src/a/"]);

    assert.deepEqual(warned.ignoredFiles, ["live.log"], "起動前からあり、中身が変わっただけのもの");
    assert.deepEqual(warned.violations, ["new.log"], "新しく作られた無視対象のファイルは違反");
    assert.deepEqual(strict.violations, ["live.log", "new.log"], "既定は従来どおり違反");
  } finally { cleanup(); }
});

test("許可パスの ~ と絶対パスは作業場所からの相対に直し、作業場所の外は誤りにする", () => {
  const { ws, home, cleanup } = workspaceFixture();
  try {
    const options = { workspace: ws, home };

    const inside = normalizeAllow(["~/.cfg/src/a/x.ts", `${ws}/other/`, "src/b/"], options);
    const outside = normalizeAllow(["~/elsewhere/x.ts"], options);

    assert.deepEqual(inside, { allow: ["src/a/x.ts", "other/", "src/b/"], errors: [] });
    assert.match(outside.errors.join(), /作業場所の外のパス: ~\/elsewhere\/x\.ts/);
  } finally { cleanup(); }
});

test("作業場所はリポジトリの中のサブディレクトリでもよく、root の中なら入れ子で拒否する", () => {
  const { root, ws, cleanup } = workspaceFixture();
  try {
    fs.mkdirSync(path.join(ws, "src/b"), { recursive: true });

    assert.deepEqual(workspaceErrors(root, path.join(ws, "src")), []);
    assert.match(workspaceErrors(root, path.join(root, "src")).join(), /入れ子/);
    assert.match(workspaceErrors(root, path.join(ws, "missing")).join(), /ディレクトリではない/);
  } finally { cleanup(); }
});

test("warn でも、.gitignore を足して新しいファイルを無視させる書き込みは違反にする", () => {
  const { pkg, runDir, cleanup } = subdirFixture();
  try {
    const snapshot = takeSnapshot(pkg, runDir);
    write(pkg, "src/a/.gitignore", "*\n");
    write(pkg, "src/a/evil.mjs", "evil\n");

    const result = gate(snapshot, ["src/a/x.ts"], { ignoredFiles: "warn" });

    assert.equal(result.passed, false);
    assert.deepEqual(result.ignoredFiles, []);
    assert.deepEqual(result.violations, ["src/a/.gitignore", "src/a/evil.mjs"]);
  } finally { cleanup(); }
});

test("作業場所に .gitignore 対象のディレクトリは渡せない", () => {
  const { root, ws, cleanup } = subdirFixture();
  try {
    fs.mkdirSync(path.join(ws, "logs.log"));

    assert.match(workspaceErrors(root, path.join(ws, "logs.log")).join(), /\.gitignore 対象/);
  } finally { cleanup(); }
});

test("規約はリポジトリの最上位のものも選び、paths はその規約の置き場所からの相対で照合する", () => {
  const { root, ws, pkg, cleanup } = subdirFixture();
  try {
    write(ws, ".claude/rules/pkg.md", '---\npaths:\n  - "pkg/src/**"\n---\n\n# Pkg\n');
    write(pkg, ".claude/rules/local.md", '---\npaths:\n  - "src/**"\n---\n\n# Local\n');

    const { rules } = selectRules(pkg, ["src/a/x.ts"], [pkg, ws, root]);

    const expected = [".claude/rules/local.md", path.join(ws, ".claude/rules/pkg.md")];
    assert.deepEqual(rules.map((r) => r.file), expected);
  } finally { cleanup(); }
});

test("ref 範囲付き snapshot は自ブランチだけを gate し、範囲なしは全 ref を見る", () => {
  const { root, base, cleanup } = fixture();
  try {
    git(root, "add", "-A");
    git(root, "commit", "-qm", "fixture changes");
    const mainBranch = git(root, "symbolic-ref", "--short", "HEAD").trim();
    const worktreeBranch = "codex-worker/T7";
    const worktree = path.join(base, "worker");
    git(root, "worktree", "add", "-b", worktreeBranch, worktree, "HEAD");
    const refScope = ["refs/heads/codex-worker/T7"];
    const scopedRunDir = path.join(base, "scoped-run");
    const allRefsRunDir = path.join(base, "all-refs-run");
    const scoped = takeSnapshot(worktree, scopedRunDir, { refScope });
    const allRefs = takeSnapshot(worktree, allRefsRunDir);

    assert.deepEqual(scoped.refScope, refScope);
    const savedSnapshot = JSON.parse(
      fs.readFileSync(path.join(scopedRunDir, "snapshot.json"), "utf8"),
    );
    assert.deepEqual(savedSnapshot.refScope, refScope);
    assert.equal("refScope" in allRefs, false);

    write(root, "main-only.txt", "main\n");
    git(root, "add", "main-only.txt");
    git(root, "commit", "-qm", "main branch commit");
    assert.equal(
      gate(scoped, []).passed,
      true,
      "本体のコミットは linked worktree の範囲外",
    );
    assert.deepEqual(gate(allRefs, []).repoChanges, ["refs"], "範囲なし snapshot は全 ref を見る");

    git(root, "checkout", "-qb", "other-branch");
    write(root, "other-branch.txt", "other\n");
    git(root, "add", "other-branch.txt");
    git(root, "commit", "-qm", "other branch commit");
    git(root, "checkout", mainBranch);
    assert.equal(
      gate(scoped, []).passed,
      true,
      "別ブランチのコミットは linked worktree の範囲外",
    );

    write(worktree, "src/a/x.ts", "staged on worker\n");
    git(worktree, "add", "src/a/x.ts");
    assert.deepEqual(
      gate(scoped, []).repoChanges,
      ["index"],
      "自ブランチの worktree index の add は検出",
    );
    git(worktree, "commit", "-qm", "worker branch commit");
    const selfCommit = gate(scoped, []);
    assert.ok(selfCommit.repoChanges.includes("head"));
    assert.ok(selfCommit.repoChanges.includes("refs"));
  } finally { cleanup(); }
});

test("worktree への付け替えは対象と許可パスの ~・絶対パスに適用し、省略時は従来どおり", () => {
  const { root, ws, home, base, cleanup } = workspaceFixture();
  try {
    write(ws, "pkg/src/a/x.ts", "x1\n");
    write(ws, "pkg/other/y.ts", "y1\n");
    git(ws, "add", "-A");
    git(ws, "commit", "-qm", "pkg fixture");

    const worktree = path.join(base, "worktree");
    git(ws, "worktree", "add", "-b", "codex-worker/T7-relocate", worktree, "HEAD");
    const workspace = path.join(worktree, "pkg");
    const relocate = { from: ws, to: worktree };
    const targets = ["~/.cfg/pkg/src/a/", `${ws}/pkg/other/`]
      .map((target) => `\`${target}\``)
      .join("、");
    withTodo(root, `**#1-1 / T7** — 完了条件: 対象: ${targets}。`);

    const absoluteAllow = `${ws}/pkg/other/`;
    const homeAllow = "~/.cfg/pkg/src/a/x.ts";
    const relocated = normalizeAllow([homeAllow, absoluteAllow, "src/b/"], {
      workspace,
      home,
      relocate,
    });
    const unrelocated = normalizeAllow([homeAllow, absoluteAllow], { workspace, home });

    assert.deepEqual(relocated, { allow: ["src/a/x.ts", "other/", "src/b/"], errors: [] });
    assert.deepEqual(unrelocated, {
      allow: [],
      errors: [
        `作業場所の外のパス: ${homeAllow}`,
        `作業場所の外のパス: ${absoluteAllow}`,
      ],
    });
    assert.deepEqual(
      checkAllow(root, "T7", relocated.allow.slice(0, 2), 3, { workspace, home, relocate }).errors,
      [],
    );
    assert.match(
      checkAllow(root, "T7", ["src/a/x.ts", "other/"], 3, { workspace, home })
        .errors.join(),
      /T の対象の外/,
    );
  } finally { cleanup(); }
});
