import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { breakdownTaskIds, expandTaskIds } from "../todo.mjs";

// cli.mjs の e2e(実プロセス起動)。雛形どおりの整合したプロジェクトを作り、1 か所ずつ崩して
// その検査だけが検出することを確かめる。旧規約のファイル(冒頭コメントが規則を定義していない)を
// 新しい規約で検出しないことも確かめる。
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

const HEADER_COMMENT = "<!--\n規約:\n- 状態は [ ] 未着手 / [x] 完了 / [-] 廃止 の 3 値。\n-->\n";

function todoText({
  planState = "[ ]",
  rows = ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B | — | [ ] |"],
  blocks = ["**#1-1 / T1** — 完了条件: A が通る", "**#1-2 / T2** — 完了条件: B が通る"],
  comment = HEADER_COMMENT,
  taskMarker = "<!-- 追記位置(#1 タスク): 新規行はこの直前 -->\n",
} = {}) {
  return (
    `${comment}\n# TODO\n\n## §0 セッションプロトコル\n\n- 開始時に読む\n\n## 計画\n\n` +
    "| #  | 計画 | 設計 | 状態 |\n| -- | ---- | ---- | ---- |\n" +
    `| #1 | alpha | docs/design/alpha.md | ${planState} |\n<!-- 追記位置(計画): 新規行はこの直前 -->\n\n` +
    "## #1 alpha\n\n| #    | T  | タスク | 実 | 状態 |\n| ---- | -- | ------ | -- | ---- |\n" +
    `${rows.join("\n")}\n${taskMarker}\n共通の前提(計画 #1 の全タスク): 設計書第 1 項\n\n` +
    `${blocks.join("\n\n")}\n<!-- 追記位置(#1 完了条件): 新規ブロックはこの直前 -->\n`
  );
}

function designText({ breakdown = "- `TODO.md` の T1〜T2", title = "アルファ" } = {}) {
  return `# 設計: ${title}\n\n全体構想: なし\n\n## 方針・構成\n\n本文\n\n## タスク分解\n\n${breakdown}\n`;
}

const INDEX_HEAD = "<!--\n- T: 例 `T1〜T6`\n-->\n\n# 設計書索引\n\n| 作成日 | フェーズ | 設計書 | 表題 | T |\n| ------ | -------- | ------ | ---- | - |\n";

function createProject({ todo = todoText(), design = designText(), index = `${INDEX_HEAD}| 2026-09-25 | — | [alpha](alpha.md) | アルファ | T1〜T2 |\n`, archive = "", decisions = "" } = {}) {
  const root = mkdtempSync(join(tmpdir(), "rule-check-"));
  mkdirSync(join(root, "docs", "design"), { recursive: true });
  mkdirSync(join(root, ".claude", "archive"), { recursive: true });
  writeFileSync(join(root, "TODO.md"), todo);
  writeFileSync(join(root, "docs", "design", "alpha.md"), design);
  if (index !== null) writeFileSync(join(root, "docs", "design", "index.md"), index);
  writeFileSync(join(root, ".claude", "archive", "TODO.md"), archive);
  writeFileSync(join(root, "docs", "decisions.md"), `| 日付 | タスクID | 判断内容 | 理由 |\n| ---- | -------- | -------- | ---- |\n${decisions}`);
  return root;
}

function run(root, ...extra) {
  const result = spawnSync("node", [cliPath, root, ...extra], { encoding: "utf8" });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr, ng: result.stdout.split("\n").filter((line) => line.startsWith("NG ")) };
}

function withProject(options, body) {
  const root = createProject(options);
  try {
    body(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("整合したプロジェクトは ok で終了コード 0", () => {
  withProject({}, (root) => {
    const result = run(root);
    assert.equal(result.status, 0, result.stdout);
    assert.match(result.stdout, /^todo_format: new$/m);
    assert.match(result.stdout, /^result: ok$/m);
  });
});

test("検査対象の文書が 1 つも無ければ終了コード 2", () => {
  const root = mkdtempSync(join(tmpdir(), "rule-check-"));
  try {
    const result = run(root);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /検査対象の文書/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const cases = [
  ["追記位置マーカーの欠落", { todo: todoText({ taskMarker: "" }) }, /^NG markers: #1 の追記位置マーカー\(タスク\)が 0 本/],
  ["完了条件ブロックの無いタスク行", { todo: todoText({ blocks: ["**#1-1 / T1** — 完了条件: A が通る"] }) }, /^NG row-block-pairing: #1-2 \/ T2 のタスク行に対応する完了条件ブロックが無い/],
  [
    "archive との T の重複",
    { archive: "| #    | T  | タスク | 実 | 状態 |\n| ---- | -- | ------ | -- | ---- |\n| #9-1 | T1 | 古い | Claude/opus5 | [x] |\n" },
    /^NG task-id-unique: T1 のタスク行が 2 行ある/,
  ],
  [
    "#<n>-<m> の逆順",
    { todo: todoText({ rows: ["| #1-2 | T2 | 作業B | — | [ ] |", "| #1-1 | T1 | 作業A | Claude/opus5 | [x] |"] }) },
    /^NG plan-index-order: #1 のタスク行が #<n>-<m> の昇順に並んでいない/,
  ],
  ["設計書の「タスク分解」節との食い違い", { design: designText({ breakdown: "- `TODO.md` の T1" }), index: null }, /^NG design-breakdown: .*\(T1\).*\(T1〜T2\)/],
  [
    "配下が全て完了なのに計画行が [ ]",
    { todo: todoText({ rows: ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B (廃止: 不要。→T1) | — | [-] |"] }), decisions: "| 2026-09-25 | T2 | 廃止 | 不要 |\n" },
    /^NG plan-state: 計画 #1 の状態が \[ \]\(配下の状態からは \[x\] が正\)/,
  ],
  [
    "未分解の段階が残るのに計画行が [x]",
    {
      todo: todoText({ planState: "[x]", rows: ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B | Claude/opus5 | [x] |"] }),
      design: designText({ breakdown: "段階 1: T1〜T2\n段階 2: 未分解" }),
    },
    /^NG plan-state: 計画 #1 の状態が \[x\]\(配下の状態からは \[ \] が正\(設計書に `段階 <n>: 未分解` が残る\)\)/,
  ],
  ["[x] なのに 実 列が —", { todo: todoText({ rows: ["| #1-1 | T1 | 作業A | — | [x] |", "| #1-2 | T2 | 作業B | — | [ ] |"] }) }, /^NG executor-column: T1 は \[x\] なのに 実 列が — のまま/],
  [
    "廃止の注記と decisions の行が無い [-]",
    { todo: todoText({ rows: ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B | — | [-] |"], planState: "[x]" }) },
    /^NG abolished: T2 は \[-\] なのにタスク名の末尾に/,
  ],
  [
    "実在しない由来",
    { todo: todoText({ blocks: ["**#1-1 / T1** — 完了条件: A が通る", "**#1-2 / T2** — 完了条件: B が通る [由来: T7]"] }) },
    /^NG origin-tag: T2 の由来 T7 が TODO\.md にも archive にも無い/,
  ],
  ["索引の表題の食い違い", { index: `${INDEX_HEAD}| 2026-09-25 | — | [alpha](alpha.md) | 別名 | T1〜T2 |\n` }, /^NG design-index: 索引の alpha\.md の表題「別名」/],
  ["索引の T 列が — のまま", { index: `${INDEX_HEAD}| 2026-09-25 | — | [alpha](alpha.md) | アルファ | — |\n` }, /^NG design-index: 索引の alpha\.md の T 列が — だが/],
  ["索引に行の無い設計書", { index: INDEX_HEAD }, /^NG design-index: 索引に alpha\.md の行が無い/],
];

for (const [name, options, expected] of cases) {
  test(`検出: ${name}`, () => {
    withProject(options, (root) => {
      const result = run(root);
      assert.equal(result.status, 1, result.stdout);
      assert.ok(result.ng.some((line) => expected.test(line)), result.stdout);
    });
  });
}

test("索引の規約コメントにある T の記述例を実データとして拾わない", () => {
  withProject({}, (root) => {
    const result = run(root);
    assert.deepEqual(result.ng, [], result.stdout);
  });
});

test("未分解の段階が残る計画は、配下が全て完了でも [ ] のままで ok", () => {
  const todo = todoText({ rows: ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B | Claude/opus5 | [x] |"] });
  withProject({ todo, design: designText({ breakdown: "段階 1: T1〜T2\n段階 2: 未分解" }) }, (root) => {
    assert.equal(run(root).status, 0);
  });
});

test("[-] を定義しない旧規約では、全て [x] なのに [ ] の計画だけを検出する", () => {
  const rows = ["| #1-1 | T1 | 作業A | Claude/opus5 | [x] |", "| #1-2 | T2 | 作業B | Claude/opus5 | [x] |"];
  withProject({ todo: todoText({ comment: "<!--\n規約: 旧\n-->\n", rows }) }, (root) => {
    assert.ok(run(root).ng.some((line) => /^NG plan-state: 計画 #1 は配下が全て \[x\] なのに \[ \] のまま/.test(line)));
  });
});

test("--base: 完了条件を変えた T に decisions の行が無ければ検出し、あれば通す", () => {
  withProject({}, (root) => {
    const git = (...args) => execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
    git("init", "-q");
    git("add", "-A");
    git("commit", "-q", "-m", "init");
    writeFileSync(join(root, "TODO.md"), todoText({ blocks: ["**#1-1 / T1** — 完了条件: A が通る", "**#1-2 / T2** — 完了条件: B と C が通る"] }));
    const missing = run(root, "--base", "HEAD");
    assert.equal(missing.status, 1, missing.stdout);
    assert.match(missing.stdout, /^changed_since_base\(HEAD\): T2$/m);
    assert.ok(missing.ng.some((line) => /^NG decisions-for-changes: T2 /.test(line)), missing.stdout);

    writeFileSync(join(root, "docs", "decisions.md"), "| 日付 | タスクID | 判断内容 | 理由 |\n| ---- | -------- | -------- | ---- |\n| 2026-09-25 | T2 | 完了条件に C を追加 | 穴 |\n");
    assert.equal(run(root, "--base", "HEAD").status, 0);
  });
});

test("--base の版を読めなければ終了コード 2", () => {
  withProject({}, (root) => {
    const result = run(root, "--base", "no-such-rev");
    assert.equal(result.status, 2);
  });
});

test("「タスク分解」節の散文が名指しする他の計画の T は、分解した T に数えない", () => {
  const breakdown =
    "- 段階 1(唯一の段階): `TODO.md` の T1〜T2(完了条件はそちらが正)。最終統合は既存の T19 が担う\n- 着手の前提として既存の T33 を先に終える";
  withProject({ design: designText({ breakdown }) }, (root) => {
    assert.equal(run(root).status, 0);
  });
  assert.deepEqual([...breakdownTaskIds("- `TODO.md` の T35〜T36、T59(完了条件は…)。T47 は小節のタスク")], [35, 36, 59]);
  assert.deepEqual([...breakdownTaskIds("段階 1: T1〜T2\n段階 2: 未分解")], [1, 2]);
});

test("expandTaskIds は範囲と列挙を展開する", () => {
  assert.deepEqual([...expandTaskIds("T42〜T44, T120")], [42, 43, 44, 120]);
  assert.deepEqual([...expandTaskIds("—")], []);
});

function git(root, ...args) {
  return execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args]);
}

function commitAll(root) {
  git(root, "init", "-q");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "init");
}

const HANDOFF_COMMENT = "<!--\n常に1画面＝40行以内に保つ(この規約コメントを除いた本文の行数)。\n要確認: 行の先頭に回収点を固定書式で書く。\n-->\n";

function handoffText(pending, comment = HANDOFF_COMMENT) {
  return `# HANDOFF\n\n${comment}\n目標: x\n\n## 次セッションの最初の一手\n\n- /execute-task T2\n\n## 要確認(ユーザー判断待ち)\n\n${pending.join("\n")}\n`;
}

test("HANDOFF.md: 回収点の無い要確認と、回収点の T が既に完了した要確認を検出する", () => {
  withProject({}, (root) => {
    writeFileSync(join(root, "HANDOFF.md"), handoffText(["- 回収点の無い問い", "- [回収: T1 着手前] T1 は完了済み", "- [回収: T2 着手前] まだ未着手", "- [回収: 次の /follow-up] 総点検で問う"]));
    const result = run(root);
    assert.deepEqual(
      result.ng.map((line) => line.replace(/: .*$/, "")),
      ["NG handoff-pending", "NG handoff-pending"],
      result.stdout,
    );
    assert.ok(result.ng.some((line) => /回収点 T1 は既に \[x\]/.test(line)), result.stdout);
  });
});

test("HANDOFF.md: 回収点を定義していない旧規約のファイルは検査しない", () => {
  withProject({}, (root) => {
    writeFileSync(join(root, "HANDOFF.md"), handoffText(["- 回収点の無い問い"], "<!--\n旧い規約\n-->\n"));
    assert.equal(run(root).status, 0);
  });
});

test("行数予算: 宣言より長い文書を検出し、HANDOFF.md は規約コメントを除いた本文で数える", () => {
  withProject({}, (root) => {
    const pending = Array.from({ length: 30 }, () => "- なし");
    writeFileSync(join(root, "HANDOFF.md"), handoffText(pending));
    const result = run(root);
    assert.ok(result.ng.some((line) => /^NG line-budget: HANDOFF\.md が 4\d 行\(規約コメントを除いた本文、予算 40 行\)/.test(line)), result.stdout);
    writeFileSync(join(root, "HANDOFF.md"), handoffText(pending.slice(0, 20)));
    assert.equal(run(root).status, 0);
  });
});

const DESIGN_COMMENT = "<!--\n- 「全体構想」行の書式は固定: `全体構想: plan.md §<節番号> / <フェーズ見出しの逐語>`\n-->\n";

test("設計書の「全体構想」行: 書式と、指す節・フェーズ見出しの実在を検査する", () => {
  const plan = "# plan\n\n## §2 フェーズ構成\n\n### フェーズ 1: 基盤\n\n## §3 運用\n\n### フェーズ 9: 後片付け\n";
  const cases = [
    ["全体構想: plan.md §2 / フェーズ 1: 基盤", null],
    ["全体構想: plan.md §2 / フェーズ 9: 後片付け", /^NG design-pointer-target: .*「フェーズ 9: 後片付け」が plan\.md §2 の中に無い/],
    ["全体構想: plan.md §7 / フェーズ 1: 基盤", /^NG design-pointer-target: .*plan\.md §7 の見出しが plan\.md に無い/],
    ["全体構想: plan.md §2", /^NG design-pointer-format: /],
  ];
  for (const [pointer, expected] of cases) {
    const design = `${DESIGN_COMMENT}\n${designText().replace("全体構想: なし", pointer)}`;
    withProject({ design }, (root) => {
      writeFileSync(join(root, "plan.md"), plan);
      const result = run(root);
      if (expected === null) assert.equal(result.status, 0, result.stdout);
      else assert.ok(result.ng.some((line) => expected.test(line)), `${pointer}\n${result.stdout}`);
    });
  }
});

test("設計書の「全体構想」行: 冒頭コメントが定義していない旧規約の設計書は検査しない", () => {
  withProject({ design: designText().replace("全体構想: なし\n", "") }, (root) => {
    assert.equal(run(root).status, 0);
  });
});

test("architecture.md: git が追跡する第 1 階層のディレクトリがツリーに無ければ検出し、途中を省いた項目も読む", () => {
  withProject({}, (root) => {
    mkdirSync(join(root, "src", "deep"), { recursive: true });
    mkdirSync(join(root, "tests"), { recursive: true });
    mkdirSync(join(root, ".claude", "rules"), { recursive: true });
    writeFileSync(join(root, "src", "deep", "a.js"), "");
    writeFileSync(join(root, "tests", "a.test.js"), "");
    writeFileSync(join(root, ".claude", "rules", "r.md"), "");
    const tree = "## ディレクトリツリー\n\n````\n.\n├── .claude/rules/   # 規約\n├── docs/\n│   └── design/\n└── src/\n    └── deep/\n````\n";
    writeFileSync(join(root, "docs", "architecture.md"), `# ディレクトリ構成\n\n${tree}`);
    commitAll(root);
    const result = run(root);
    assert.deepEqual(result.ng, ["NG architecture-tree: git が追跡する tests/ が docs/architecture.md のツリーに無い"], result.stdout);
  });
});

test("decisions.md: --base から既存の行を書き換えたら検出し、足した行の列と日付を検査する", () => {
  const head = "| 日付 | タスクID | 判断内容 | 理由 |\n| ---- | -------- | -------- | ---- |\n";
  withProject({ decisions: "| 2026-09-01 | T1 | 決定 | 理由 |\n" }, (root) => {
    const path = join(root, "docs", "decisions.md");
    writeFileSync(path, `${head}| 2026-09-01 | T1 | 決定 | 理由 |\n\n## 別の節\n`);
    commitAll(root);
    writeFileSync(path, `${head}| 2026-09-01 | T1 | 決定 | 理由 |\n| 2026-09-25 | T2 | 追加 | 理由 |\n\n## 別の節\n`);
    assert.equal(run(root, "--base", "HEAD").status, 0, "表の末尾への追記は通す");
    writeFileSync(path, `${head}| 2026-09-01 | T1 | 書き換えた | 理由 |\n| 9/25 | T2 | 追加 |\n\n## 別の節\n`);
    const result = run(root, "--base", "HEAD");
    assert.ok(result.ng.some((line) => /^NG decisions-append-only: /.test(line)), result.stdout);
    assert.ok(result.ng.some((line) => /^NG decisions-row: 追記した行の列が 3 個/.test(line)), result.stdout);
  });
});
