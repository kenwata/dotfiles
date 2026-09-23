import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
  buildPrompt, changedSince, checkAllow, checkPacketCrossCheck, checkPacketVerify, gate, packetVerifyCommands, readRollout, resolveModelFamily, restore, selectRules,
  takeSnapshot, validateResult,
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
  });
  const order = ["CONTRACT", "- `src/a/`", "PACKET", "### .claude/rules/t.md", "RULE"].map((s) => prompt.indexOf(s));
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
