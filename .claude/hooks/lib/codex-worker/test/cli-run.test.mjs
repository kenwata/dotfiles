// codex-worker の cli の試験: run の基本の流れ(受け入れ・許可外の巻き戻し・時間切れ・起動前の拒否)、restore と verify、sandbox の疎通。
// 偽の codex で確かめる(本物の codex は起動しない)。
// 足場は cli-harness.mjs。

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  VERIFY_SECTION,
  git,
  setup,
  baseArgs,
  assertStatusLogLines,
} from "./cli-harness.mjs";

const REWORK_SECTION = `## 直すこと
種別: defect
既存テストとの整合: 該当なし: 差し戻し契約を満たす試験用 packet`;

test("正常な run は exit 0 で、系統名から最新のモデルを解決し、ロックを外す", () => {
  const t = setup();
  try {
    const { code, json, stderr } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(code, 0, JSON.stringify(json));
    assert.equal(json.accepted, true);
    assert.equal(json.model, "gpt-6-luna");
    assert.equal(json.model_family, "luna");
    assert.deepEqual(json.gate.changed, ["src/a/impl.ts"]);
    assert.equal(json.metrics.peak_ratio, 0.1);
    assert.deepEqual(t.locks(), []);
    assert.ok(json.run_dir.startsWith(path.join(t.base, "state")), "run の記録は worker が書ける TMPDIR の外に置く");
    // 状態行は stderr と共有ログにだけ出る(stdout は report の JSON だけ。上の JSON.parse が通ることで確かめている)
    const expected = [
      "$ npm test", "  ✓ npm test", "edit: src/a/impl.ts (add)",
      "tokens: input=10 cached=0 output=5", "finished: accepted worker=done changed=1",
    ];
    for (const out of [stderr, fs.readFileSync(t.statusLog, "utf8")]) {
      for (const line of expected) assert.ok(out.includes(line), `${line} が無い:\n${out}`);
      assert.match(out, /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} model=gpt-6-luna /m);
    }
    assertStatusLogLines(stderr);
    assertStatusLogLines(fs.readFileSync(t.statusLog, "utf8"));
  } finally { t.cleanup(); }
});

test("許可外の変更は exit 1 で、その分だけ戻し、許可内の変更は残す", () => {
  const t = setup();
  try {
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "violate" });
    assert.equal(code, 1);
    assert.deepEqual(json.gate.violations, ["other/y.ts"]);
    assert.deepEqual(json.restore.restored, ["other/y.ts"]);
    assert.equal(fs.readFileSync(path.join(t.root, "other/y.ts"), "utf8"), "y1\n");
    assert.equal(fs.readFileSync(path.join(t.root, "src/a/impl.ts"), "utf8"), "impl\n");
    assert.equal(fs.readFileSync(json.restore.backups["other/y.ts"], "utf8"), "changed by worker\n");
  } finally { t.cleanup(); }
});

test("タイムアウトはプロセスグループごと止め、全変更を戻してロックを外す", () => {
  const t = setup();
  const pidFile = path.join(t.base, "grandchild.pid");
  try {
    const { code, json } = t.run([...baseArgs(t.root, t.packet), "--timeout", "1"], { FAKE_MODE: "sleep", FAKE_PID_FILE: pidFile });
    assert.equal(code, 1);
    assert.match(json.reasons.join(), /タイムアウト/);
    assert.deepEqual(t.locks(), []);
    const grandchild = Number(fs.readFileSync(pidFile, "utf8"));
    assert.throws(() => process.kill(grandchild, 0), /ESRCH/, "codex が起動した子プロセスも止まっている");
  } finally { t.cleanup(); }
});

test("起動前の拒否は exit 2 で JSON を出し、worker を起動しない", () => {
  const t = setup();
  try {
    fs.writeFileSync(t.packet, "x".repeat(13 * 1024));
    let result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /上限/);
    fs.writeFileSync(t.packet, "ok");
    result = t.run([...baseArgs(t.root, t.packet), "--allow", "src/a/2", "--allow", "src/a/3", "--allow", "src/a/4"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /許可パスが 4 件/);
    result = t.run(["run", "--root", t.base, "--task", "T7", "--step", "1", "--packet", t.packet, "--allow", "x"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /git のリポジトリではない/);
    fs.writeFileSync(t.packet, `## 目的\nimpl を書く\n\n## 利用者に見える文\n該当なし: 試験用\n\n## 横断の確認\n該当なし: 試験用\n\n${VERIFY_SECTION}`);
    result = t.run([...baseArgs(t.root, t.packet), "--model-family", "nova"]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /系統 nova/);
    fs.writeFileSync(t.packet, "## 目的\nimpl を書く\n");
    result = t.run(baseArgs(t.root, t.packet));
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /## 横断の確認/);
    assert.match(result.json.errors.join(), /## 検証/);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);
  } finally { t.cleanup(); }
});

test("restore は run の許可パスの中だけを戻し、記録が無ければ exit 2", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    fs.appendFileSync(path.join(t.root, "TODO.md"), "監督の追記\n");
    const restored = t.run(["restore", "--run", json.run_dir]);
    assert.equal(restored.code, 0);
    assert.deepEqual(restored.json.restore.restored, ["src/a/impl.ts"]);
    assert.equal(fs.existsSync(path.join(t.root, "src/a/impl.ts")), false);
    assert.match(fs.readFileSync(path.join(t.root, "TODO.md"), "utf8"), /監督の追記/);
    assert.equal(t.run(["restore", "--run", path.join(t.base, "missing")]).code, 2);
  } finally { t.cleanup(); }
});

test("verify は packet の検証節のコマンドを 1 本ずつ打ち、コマンドごとの終了コードを返す", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const verified = t.run(["verify", "--run", json.run_dir]);
    assert.equal(verified.code, 1, "0 でないコマンドがあれば exit 1");
    assert.equal(verified.json.all_passed, false);
    assert.deepEqual(verified.json.commands.map((c) => [c.command, c.exit_code]), [
      ["test -f src/a/impl.ts", 0], ["echo checked; exit 3", 3],
    ]);
    assert.equal(verified.json.commands[1].tail, "checked");
    assert.equal(fs.readFileSync(verified.json.commands[1].log, "utf8"), "checked\n");
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(json.run_dir, "verify.json"), "utf8")), verified.json);
    const verifyLines = [
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify \$ test -f src\/a\/impl\.ts$/m,
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify   ✗ exit 3$/m,
      /^\[Codex T7 s1 1\/2\] \d{2}:\d{2}:\d{2} verify finished: 1\/2 ok$/m,
    ];
    for (const line of ["verify $ test -f src/a/impl.ts", "verify   ✗ exit 3", "verify finished: 1/2 ok"]) {
      assert.ok(verified.stderr.includes(line), `${line} が無い:\n${verified.stderr}`);
    }
    for (const out of [verified.stderr, fs.readFileSync(t.statusLog, "utf8")]) {
      for (const line of verifyLines) assert.match(out, line);
    }
    assertStatusLogLines(verified.stderr);
    assertStatusLogLines(fs.readFileSync(t.statusLog, "utf8"));

    // 検証を打つ時点の作業ツリーを見る(worker の変更を戻せば 1 本目も落ちる)
    fs.writeFileSync(path.join(json.run_dir, "packet.md"), "## 検証\n- `test -f src/a/impl.ts`\n");
    assert.equal(t.run(["verify", "--run", json.run_dir]).code, 0);
    fs.rmSync(path.join(t.root, "src/a/impl.ts"));
    assert.equal(t.run(["verify", "--run", json.run_dir]).json.commands[0].exit_code, 1);
  } finally { t.cleanup(); }
});

test("run は worker の sandbox が loopback だけを通すと確かめられない時、worker を起動せず exit 2", () => {
  for (const [mode, pattern] of [["closed", /loopback/], ["open", /外部/]]) {
    const t = setup();
    try {
      const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok", FAKE_SANDBOX: mode });
      assert.equal(code, 2, `${mode}: ${JSON.stringify(json)}`);
      assert.equal(json.stage, "preflight");
      assert.match(json.errors.join(), pattern);
      assert.equal(t.execEnv(), null, `${mode}: worker を起動していない`);
    } finally { t.cleanup(); }
  }
});

test("run は worker に TMPDIR の下の run 専用の uv キャッシュを渡し、終わったら消す", () => {
  const t = setup();
  try {
    const { code, json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(code, 0, JSON.stringify(json));
    const env = t.execEnv();
    assert.ok(env.uv?.startsWith(t.tmp + path.sep), `TMPDIR の下: ${env.uv}`);
    assert.ok(env.uv.includes(json.run_id), `run ごとに分かれる: ${env.uv}`);
    assert.equal(env.uvExists, true, "worker の起動時には在る");
    assert.equal(fs.existsSync(env.uv), false, "run の後は消えている");
  } finally { t.cleanup(); }
});

test("verify は各コマンドを worker と同じ sandbox(codex sandbox)の中で、専用の uv キャッシュで打つ", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const before = t.sandboxCalls().length;
    const verified = t.run(["verify", "--run", json.run_dir]);
    assert.equal(verified.code, 1, JSON.stringify(verified.json));
    const calls = t.sandboxCalls().slice(before).filter((c) => !c.args.join(" ").includes("CODEX_WORKER_SANDBOX_PROBE"));
    assert.deepEqual(calls.map((c) => c.args.slice(c.args.indexOf("--") + 1)), [
      ["/bin/sh", "-c", "test -f src/a/impl.ts"], ["/bin/sh", "-c", "echo checked; exit 3"],
    ]);
    for (const call of calls) {
      assert.deepEqual(call.args.slice(0, call.args.indexOf("--")), ["sandbox", "-c", 'sandbox_mode="workspace-write"']);
      assert.equal(call.cwd, t.root);
      assert.ok(call.uv?.startsWith(t.tmp + path.sep) && call.uvExists, `専用の uv キャッシュ: ${call.uv}`);
      assert.equal(fs.existsSync(call.uv), false, "verify の後は消えている");
    }
  } finally { t.cleanup(); }
});

test("verify は sandbox が loopback だけを通すと確かめられない時、何も打たず exit 2", () => {
  const t = setup();
  try {
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    const result = t.run(["verify", "--run", json.run_dir], { FAKE_SANDBOX: "open" });
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /外部/);
    assert.equal(fs.existsSync(path.join(json.run_dir, "verify.json")), false);
  } finally { t.cleanup(); }
});

test("最初の run は利用者に見える文の節が無いか空白なら拒否する", () => {
  for (const section of ["", "   \n\t", null]) {
    const t = setup();
    try {
      const visibleSection = section === null ? "" : `## 利用者に見える文\n${section}\n\n`;
      fs.writeFileSync(t.packet, `## 目的\nimpl を書く\n\n${visibleSection}## 横断の確認\n該当なし: 試験用\n\n${VERIFY_SECTION}`);
      const result = t.run(baseArgs(t.root, t.packet));
      assert.equal(result.code, 2);
      assert.match(result.json.errors.join(), /形式.*文体.*記号/);
      assert.match(result.json.errors.join(), /倣う文: <path:行>/);
      assert.match(result.json.errors.join(), /該当なし: <理由 1 文>/);
      assert.equal(t.execEnv(), null, "worker を起動していない");
    } finally { t.cleanup(); }
  }
});

test("最初の run は利用者に見える文の節があれば通る", () => {
  const t = setup();
  try {
    const result = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(result.code, 0, JSON.stringify(result.json));
  } finally { t.cleanup(); }
});

test("同じ step の run 記録があれば利用者に見える文の節を要求しない", () => {
  const t = setup();
  try {
    const first = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(first.code, 0, JSON.stringify(first.json));
    fs.writeFileSync(
      t.packet,
      `## 目的\nimpl を書く\n\n${REWORK_SECTION}\n\n## 横断の確認\n該当なし: 試験用\n\n${VERIFY_SECTION}`,
    );
    const retry = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    assert.equal(retry.code, 0, JSON.stringify(retry.json));
  } finally { t.cleanup(); }
});

test("完了基準と守る契約の存在しない設計書参照を拒否し、存在する参照と節外の参照は通す", () => {
  const t = setup({ workspace: "repo" });
  try {
    const missing = `## 目的\ndocs/design/outside.md\n\n## 利用者に見える文\n該当なし: 試験用\n\n## 完了の基準\ndocs/design/missing.md\n\n## 守る契約\ndocs/design/also-missing.md\n\n## 横断の確認\n該当なし: 試験用\n\n${VERIFY_SECTION}`;
    fs.writeFileSync(t.packet, missing);
    let result = t.run([...baseArgs(t.root, t.packet), "--workspace", t.ws]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /docs\/design\/missing\.md/);
    assert.match(result.json.errors.join(), /docs\/design\/also-missing\.md/);
    assert.doesNotMatch(result.json.errors.join(), /docs\/design\/outside\.md/);

    fs.mkdirSync(path.join(t.ws, "docs/design"), { recursive: true });
    fs.writeFileSync(path.join(t.ws, "docs/design/present.md"), "design\n");
    fs.writeFileSync(t.packet, missing.replace("docs/design/missing.md", "docs/design/present.md")
      .replace("docs/design/also-missing.md", "docs/design/present.md"));
    result = t.run([...baseArgs(t.root, t.packet), "--workspace", t.ws], { FAKE_MODE: "ok" });
    assert.equal(result.code, 0, JSON.stringify(result.json));
  } finally { t.cleanup(); }
});

test("verify は記録が無い・検証節が無い run では何も打たず exit 2", () => {
  const t = setup();
  try {
    assert.equal(t.run(["verify", "--run", path.join(t.base, "missing")]).code, 2);
    const { json } = t.run(baseArgs(t.root, t.packet), { FAKE_MODE: "ok" });
    fs.writeFileSync(path.join(json.run_dir, "packet.md"), "## 検証\nコマンドは後で\n");
    const result = t.run(["verify", "--run", json.run_dir]);
    assert.equal(result.code, 2);
    assert.match(result.json.errors.join(), /## 検証/);
    assert.equal(fs.existsSync(path.join(json.run_dir, "verify.json")), false);
  } finally { t.cleanup(); }
});
