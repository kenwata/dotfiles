import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// cli.mjs の e2e(実プロセス起動)。一時 git リポジトリに、実プロジェクトで起きた筋書き
// (本流を分解 → 数件完了 → 支線の分解が続く)を縮めて再現し、判定を確かめる。
const cliPath = join(dirname(fileURLToPath(import.meta.url)), "..", "cli.mjs");

const PLAN_TABLE_HEADER = "| #  | 計画 | 設計 | 状態 |\n| -- | ---- | ---- | ---- |\n";
const TASK_TABLE_HEADER = "| #    | T  | タスク | 実 | 状態 |\n| ---- | -- | ------ | -- | ---- |\n";

function createProject({ declareMainline = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mainline-gauge-"));
  let clock = 1_800_000_000;
  const git = (...args) =>
    execFileSync("git", ["-C", root, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], {
      env: { ...process.env, GIT_AUTHOR_DATE: `${clock} +0000`, GIT_COMMITTER_DATE: `${clock} +0000` },
    });
  git("init", "-q");
  mkdirSync(join(root, "docs", "design"), { recursive: true });
  mkdirSync(join(root, ".claude", "archive"), { recursive: true });
  writeFileSync(join(root, "plan.md"), `# plan\n\n${declareMainline ? "本流: §7\n\n" : ""}## 7. フェーズ構成\n\n## 10. 継続運用\n`);
  const project = {
    root,
    plans: [],
    archive: "",
    addDesign(slug, section, breakdownSection = "- `TODO.md` の T1〜T2") {
      writeFileSync(
        join(root, "docs", "design", `${slug}.md`),
        `# 設計: ${slug}\n\n全体構想: plan.md §${section} / 見出し\n\n## 方針・構成\n\n本文\n\n## タスク分解\n\n${breakdownSection}\n`,
      );
    },
    commit(message) {
      const planTable = PLAN_TABLE_HEADER + project.plans.map((plan) => `| #${plan.number} | ${plan.slug} | docs/design/${plan.slug}.md | [ ] |\n`).join("");
      const sections = project.plans
        .map((plan) => `## #${plan.number} ${plan.slug}\n\n${TASK_TABLE_HEADER}${plan.tasks.map((task) => `| #${plan.number}-${task.index} | T${task.id} | 作業 | — | [${task.state}] |\n`).join("")}`)
        .join("\n");
      writeFileSync(join(root, "TODO.md"), `# TODO\n\n## 計画\n\n${planTable}\n${sections}`);
      writeFileSync(join(root, ".claude", "archive", "TODO.md"), `# TODO アーカイブ\n\n${project.archive}`);
      clock += 3600;
      git("add", "-A");
      git("commit", "-q", "-m", message);
    },
    breakDown(number, slug, taskIds) {
      project.plans.push({ number, slug, tasks: taskIds.map((id, index) => ({ id, index: index + 1, state: " " })) });
      project.commit(`plan: ${slug}`);
    },
    setState(taskId, state) {
      for (const plan of project.plans) for (const task of plan.tasks) if (task.id === taskId) task.state = state;
      project.commit(`feat: T${taskId}`);
    },
    // 完了タスクを archive へ逐語移動する(ローテーション)
    rotate(taskId) {
      for (const plan of project.plans) {
        const task = plan.tasks.find((candidate) => candidate.id === taskId);
        if (!task) continue;
        project.archive += `${TASK_TABLE_HEADER}| #${plan.number}-${task.index} | T${task.id} | 作業 | — | [${task.state}] |\n\n`;
        plan.tasks = plan.tasks.filter((candidate) => candidate.id !== taskId);
      }
      project.commit("chore: rotate");
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
  return project;
}

function runGauge(root) {
  const result = spawnSync("node", [cliPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0);
  return result.stdout;
}

test("本流の宣言が無いプロジェクトでは何も出さない", () => {
  const project = createProject({ declareMainline: false });
  project.addDesign("phase1", 7);
  project.breakDown(1, "phase1", [1, 2]);
  assert.equal(runGauge(project.root), "");
  project.cleanup();
});

test("本流が進んだ直後の最初の支線の分解は no", () => {
  const project = createProject();
  project.addDesign("phase1", 7);
  project.breakDown(1, "phase1", [1, 2, 3]);
  project.setState(1, "x");
  const output = runGauge(project.root);
  assert.match(output, /本流 #1 phase1: 完了 1 \/ 未着手 2 \/ 廃止 0/);
  assert.match(output, /支線のタスクが最後に採番された時点: なし/);
  assert.match(output, /consecutive_side_breakdown: no$/m);
  project.cleanup();
});

test("本流が止まったまま支線の分解が続くと yes になり、積まれた件数を数える", () => {
  const project = createProject();
  project.addDesign("phase1", 7);
  project.addDesign("tooling", 10);
  project.breakDown(1, "phase1", [1, 2, 3]);
  project.setState(1, "x");
  project.breakDown(2, "tooling", [4, 5]);
  project.setState(4, "x");
  const output = runGauge(project.root);
  assert.match(output, /支線 #2 tooling: 完了 1 \/ 未着手 1 \/ 廃止 0/);
  assert.match(output, /それ以後に採番されたタスク: 2 件\(#2 tooling 2 件\)/);
  assert.match(output, /consecutive_side_breakdown: yes$/m);
  project.cleanup();
});

test("支線の分解の後に本流が 1 件でも完了すれば no に戻る", () => {
  const project = createProject();
  project.addDesign("phase1", 7);
  project.addDesign("tooling", 10);
  project.breakDown(1, "phase1", [1, 2, 3]);
  project.breakDown(2, "tooling", [4, 5]);
  project.setState(2, "x");
  const output = runGauge(project.root);
  assert.match(output, /それ以後に採番されたタスク: 0 件/);
  assert.match(output, /consecutive_side_breakdown: no$/m);
  project.cleanup();
});

test("archive へ移った完了タスクと廃止を数え、移動を完了や採番として数え直さない", () => {
  const project = createProject();
  project.addDesign("phase1", 7);
  project.addDesign("tooling", 10);
  project.breakDown(1, "phase1", [1, 2, 3]);
  project.setState(1, "x");
  project.breakDown(2, "tooling", [4, 5]);
  project.setState(3, "-");
  project.rotate(1);
  const output = runGauge(project.root);
  assert.match(output, /本流 #1 phase1: 完了 1 \/ 未着手 1 \/ 廃止 1/);
  assert.match(output, /それ以後に採番されたタスク: 2 件/);
  assert.match(output, /consecutive_side_breakdown: yes$/m);
  project.cleanup();
});

test("設計書の「タスク分解」節に未分解の段階が残っていれば知らせる", () => {
  const project = createProject();
  project.addDesign("phase1", 7, "- 段階 1: T1〜T2\n- 段階 2: 未分解");
  project.breakDown(1, "phase1", [1, 2]);
  assert.match(runGauge(project.root), /本流 #1 phase1: 完了 0 \/ 未着手 2 \/ 廃止 0、未分解の段階あり/);
  project.cleanup();
});

test("雛形の説明文に含まれる「未分解」の語は、未分解の段階として数えない", () => {
  const project = createProject();
  project.addDesign("phase1", 7, "- `TODO.md` の T1〜T2\n  ({{段階ごとに書く: `段階 1: T1〜T2` / `段階 2: 未分解`。`未分解` の語は固定}})");
  project.breakDown(1, "phase1", [1, 2]);
  assert.doesNotMatch(runGauge(project.root), /未分解の段階あり/);
  project.cleanup();
});

test("設計書を引けない計画は不明と表示し、判定では支線として扱う", () => {
  const project = createProject();
  project.addDesign("phase1", 7);
  project.breakDown(1, "phase1", [1, 2]);
  project.setState(1, "x");
  project.breakDown(2, "orphan", [3]);
  const output = runGauge(project.root);
  assert.match(output, /不明\(設計書の「全体構想」行を読めない。判定では支線として扱う\) #2 orphan/);
  assert.match(output, /consecutive_side_breakdown: yes$/m);
  project.cleanup();
});

test("本流を宣言しているのに TODO.md が無ければ、無出力ではなく理由を出す", () => {
  const root = mkdtempSync(join(tmpdir(), "mainline-gauge-notodo-"));
  writeFileSync(join(root, "plan.md"), "本流: §7\n");
  const result = spawnSync("node", [cliPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /計測できない — TODO.md が無い/);
  rmSync(root, { recursive: true, force: true });
});

test("git 管理外でも落ちずに exit 0", () => {
  const root = mkdtempSync(join(tmpdir(), "mainline-gauge-nogit-"));
  writeFileSync(join(root, "plan.md"), "本流: §7\n");
  writeFileSync(join(root, "TODO.md"), "# TODO\n");
  const result = spawnSync("node", [cliPath, root], { encoding: "utf8" });
  assert.equal(result.status, 0);
  rmSync(root, { recursive: true, force: true });
});
