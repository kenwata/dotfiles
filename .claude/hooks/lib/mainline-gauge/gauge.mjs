import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

// 本流の計器: 「本流がどれだけ止まっているか」と「その間に何件のタスクが積まれたか」を、
// plan.md の宣言・設計書の「全体構想」行・TODO.md と archive・git 履歴から機械的に出す。
// 規約の正は ~/.claude/templates/BLUEPRINT.md §6「本流の計器」。呼び出し元は commands/breakdown.md。
//
// 完了と採番の時刻は、コミット要約の grep ではなくタスク行の差分から取る。要約の prefix は
// 不揃いで、checkpoint のコミットも T を含むため、要約からは「いつ完了したか」を決められない。

const ARCHIVE_CANDIDATES = [".claude/archive/TODO.md", ".codex/archive/TODO.md"];
const MAINLINE_DECLARATION = /^本流:\s*§\s*(\d+)\s*$/m;
const DESIGN_POINTER = /^全体構想:\s*plan\.md\s*§\s*(\d+)/m;
// 計画テーブルの行。`難` 列を持つ方言(| # | 計画 | 設計 | 難 | 状態 |)でも設計書のパスまでは同じ並び
const PLAN_ROW = /^\|\s*#(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?docs\/design\/[^|\s]+)\s*\|/;
const TASK_ROW = /^\|\s*#(\d+)-(\d+)\s*\|\s*T(\d+)\s*\|.*\|\s*\[( |x|-)\]\s*\|\s*$/;
// 設計書の「タスク分解」節で、まだ分解していない段階を示す固定書式の行(行頭の `段階 <n>: 未分解`)。
// 雛形の説明文は文中に `未分解` の語を含むため、語の有無ではなく行の書式で判定する
const UNDECOMPOSED_STAGE = /^\s*(?:[-*]\s*)?段階\s*\d+\s*[::]\s*未分解/m;
const COMMIT_MARK = "@@@commit ";

function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

export function parseMainlineSection(planText) {
  const match = planText?.match(MAINLINE_DECLARATION);
  return match ? Number(match[1]) : null;
}

function readDesigns(projectRoot) {
  const designDir = join(projectRoot, "docs", "design");
  const designs = new Map();
  if (!existsSync(designDir)) return designs;
  for (const name of readdirSync(designDir)) {
    if (!name.endsWith(".md") || name === "index.md") continue;
    const text = readFileSync(join(designDir, name), "utf8");
    const pointer = text.match(DESIGN_POINTER);
    const breakdownSection = text.split(/^## タスク分解\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    designs.set(`docs/design/${name}`, {
      section: pointer ? Number(pointer[1]) : null,
      hasUndecomposedStage: UNDECOMPOSED_STAGE.test(breakdownSection),
    });
  }
  return designs;
}

function parsePlansAndTasks(texts) {
  const plans = new Map();
  const tasks = new Map();
  for (const text of texts) {
    for (const line of (text ?? "").split("\n")) {
      const plan = line.match(PLAN_ROW);
      if (plan) {
        // 計画名に括弧書きの注記が付く運用があるため、表示用の名前は最初の括弧の手前まで
        plans.set(Number(plan[1]), { slug: plan[2].split(/[((]/)[0].trim(), design: plan[3].trim() });
        continue;
      }
      const task = line.match(TASK_ROW);
      if (task) tasks.set(Number(task[3]), { plan: Number(task[1]), state: task[4] });
    }
  }
  return { plans, tasks };
}

function readTaskHistory(projectRoot, paths) {
  let log;
  try {
    log = execFileSync(
      "git",
      ["-C", projectRoot, "log", "--reverse", "-p", "--unified=0", `--format=${COMMIT_MARK}%ct`, "--", ...paths],
      { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 },
    );
  } catch {
    return null;
  }
  const createdAt = new Map();
  const completedAt = new Map();
  let commitTime = 0;
  for (const line of log.split("\n")) {
    if (line.startsWith(COMMIT_MARK)) {
      commitTime = Number(line.slice(COMMIT_MARK.length));
      continue;
    }
    if (!line.startsWith("+|")) continue;
    const task = line.slice(1).match(TASK_ROW);
    if (!task) continue;
    const taskId = Number(task[3]);
    // archive への逐語移動でも同じ行が + で現れるため、最初に現れた時刻だけを採る
    if (!createdAt.has(taskId)) createdAt.set(taskId, commitTime);
    if (task[4] === "x" && !completedAt.has(taskId)) completedAt.set(taskId, commitTime);
  }
  return { createdAt, completedAt };
}

export function measure(projectRoot) {
  const mainlineSection = parseMainlineSection(readIfExists(join(projectRoot, "plan.md")));
  if (mainlineSection === null) return null;

  const archivePaths = ARCHIVE_CANDIDATES.filter((path) => existsSync(join(projectRoot, path)));
  const todoText = readIfExists(join(projectRoot, "TODO.md"));
  // 本流を宣言しているのに測れない場合は、対象外(無出力)と区別できるよう理由を返す
  if (todoText === null) return { mainlineSection, unmeasurable: "TODO.md が無い" };
  const { plans, tasks } = parsePlansAndTasks([
    todoText,
    ...archivePaths.map((path) => readFileSync(join(projectRoot, path), "utf8")),
  ]);
  const history = readTaskHistory(projectRoot, ["TODO.md", ...archivePaths]);
  if (history === null) return { mainlineSection, unmeasurable: "git の履歴を読めない(git 管理外、または履歴が大きすぎる)" };
  if (plans.size === 0) return { mainlineSection, unmeasurable: "TODO.md に計画テーブル(| #<n> | 計画 | docs/design/… |)が無い" };

  const designs = readDesigns(projectRoot);
  // 設計書を引けない計画(ファイルが無い、「全体構想」行が plan.md を指していない)は本流とも支線とも
  // 決められない。判定では支線側に倒す(問いが出る側 = 見落とさない側)が、出力で必ず知らせる
  const classify = (planNumber) => {
    const section = designs.get(plans.get(planNumber)?.design)?.section;
    return section === undefined || section === null ? null : section === mainlineSection;
  };
  const isMainlinePlan = (planNumber) => classify(planNumber) === true;

  const planSummaries = [...plans.entries()]
    .sort(([left], [right]) => left - right)
    .map(([planNumber, plan]) => {
      const states = [...tasks.values()].filter((task) => task.plan === planNumber).map((task) => task.state);
      return {
        planNumber,
        slug: plan.slug,
        mainline: classify(planNumber),
        done: states.filter((state) => state === "x").length,
        open: states.filter((state) => state === " ").length,
        abolished: states.filter((state) => state === "-").length,
        hasUndecomposedStage: designs.get(plan.design)?.hasUndecomposedStage ?? false,
      };
    });

  let lastMainlineCompletion = null;
  for (const [taskId, time] of history.completedAt) {
    const task = tasks.get(taskId);
    if (task && isMainlinePlan(task.plan) && (lastMainlineCompletion === null || time > lastMainlineCompletion)) {
      lastMainlineCompletion = time;
    }
  }

  const createdSince = new Map();
  const tasksWithoutPlanRow = [...tasks.values()].filter((task) => !plans.has(task.plan)).length;
  let lastSideBreakdown = null;
  for (const [taskId, time] of history.createdAt) {
    const task = tasks.get(taskId);
    if (!task) continue;
    const mainline = isMainlinePlan(task.plan);
    if (!mainline && (lastSideBreakdown === null || time > lastSideBreakdown)) lastSideBreakdown = time;
    if (lastMainlineCompletion !== null && time <= lastMainlineCompletion) continue;
    createdSince.set(task.plan, (createdSince.get(task.plan) ?? 0) + 1);
  }

  // 直前の支線の分解より後に本流の完了が 1 件も無ければ、今回の支線の分解は「本流が
  // 進まないままの積み増し」になる。閾値も、再発火を抑える状態の記録も要らない判定
  const consecutiveSideBreakdown =
    lastSideBreakdown !== null && (lastMainlineCompletion === null || lastMainlineCompletion <= lastSideBreakdown);

  return {
    mainlineSection,
    planSummaries,
    lastMainlineCompletion,
    createdSince,
    lastSideBreakdown,
    consecutiveSideBreakdown,
    tasksWithoutPlanRow,
  };
}

function formatTime(epochSeconds) {
  if (epochSeconds === null) return "なし";
  const date = new Date(epochSeconds * 1000);
  const pad = (value) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function render(measurement) {
  if (measurement.unmeasurable) {
    return `本流の計器(plan.md の本流: §${measurement.mainlineSection}): 計測できない — ${measurement.unmeasurable}`;
  }
  const lines = [`本流の計器(plan.md の本流: §${measurement.mainlineSection})`];
  const label = (mainline) => (mainline === null ? "不明(設計書の「全体構想」行を読めない。判定では支線として扱う)" : mainline ? "本流" : "支線");
  for (const plan of measurement.planSummaries) {
    const stage = plan.hasUndecomposedStage ? "、未分解の段階あり" : "";
    lines.push(
      `- ${label(plan.mainline)} #${plan.planNumber} ${plan.slug}: 完了 ${plan.done} / 未着手 ${plan.open} / 廃止 ${plan.abolished}${stage}`,
    );
  }
  lines.push(`- 本流の最後の完了: ${formatTime(measurement.lastMainlineCompletion)}`);
  const sinceTotal = [...measurement.createdSince.values()].reduce((sum, count) => sum + count, 0);
  const sinceByPlan = measurement.planSummaries
    .filter((plan) => measurement.createdSince.has(plan.planNumber))
    .map((plan) => `#${plan.planNumber} ${plan.slug} ${measurement.createdSince.get(plan.planNumber)} 件`)
    .join("、");
  lines.push(`- それ以後に採番されたタスク: ${sinceTotal} 件${sinceByPlan ? `(${sinceByPlan})` : ""}`);
  lines.push(`- 支線のタスクが最後に採番された時点: ${formatTime(measurement.lastSideBreakdown)}`);
  if (measurement.tasksWithoutPlanRow > 0) {
    lines.push(`- 計画テーブルに行の無い計画のタスク: ${measurement.tasksWithoutPlanRow} 件(上の内訳に現れない。判定では支線として扱う)`);
  }
  lines.push(`consecutive_side_breakdown: ${measurement.consecutiveSideBreakdown ? "yes" : "no"}`);
  return lines.join("\n");
}
