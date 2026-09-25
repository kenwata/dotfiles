import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { cells, leadingComment, readIfExists } from "./markdown.mjs";

// TODO.md を軸にした検査: TODO.md と archive の構造、設計書の「タスク分解」節、設計書索引、
// docs/decisions.md のタスクID列。規約の正は ~/.claude/templates/skeletons/todo.md と
// design-index.md の冒頭コメント。

const ARCHIVE_CANDIDATES = [".claude/archive/TODO.md", ".codex/archive/TODO.md"];
// 雛形は半角の括弧・コロンだが、既存プロジェクトの全角の揺れも受け付ける
const PLAN_MARKER = /^<!--\s*追記位置[((]計画[))]/;
const TASK_MARKER = /^<!--\s*追記位置[((]#(\d+)\s*タスク[))]/;
const BLOCK_MARKER = /^<!--\s*追記位置[((]#(\d+)\s*完了条件[))]/;
const SECTION_HEADING = /^##\s+#(\d+)\s/;
// `難` 列を持つ方言(| # | 計画 | 設計 | 難 | 状態 |)も受けるため、設計と状態の間の列は 0 個以上
const PLAN_ROW = /^\|\s*#(\d+)\s*\|\s*([^|]+?)\s*\|\s*([^|]*?docs\/design\/[^|\s]+)\s*\|(?:[^|]*\|)*\s*\[( |x|-)\]\s*\|\s*$/;
const TASK_ROW = /^\|\s*#(\d+)-(\d+)\s*\|\s*T(\d+)\s*\|.*\|\s*\[( |x|-)\]\s*\|\s*$/;
const BLOCK_HEAD = /^\*\*#(\d+)-(\d+)\s*\/\s*T(\d+)\*\*/;
const ORIGIN_TAG = /\[由来[::]\s*T(\d+)\]/g;
const ABOLISHED_NAME = /[((]廃止[::][^))]*[))]\s*$/;
const UNDECOMPOSED_STAGE = /^\s*(?:[-*]\s*)?段階\s*\d+\s*[::]\s*未分解/m;
const TASK_ID_OR_RANGE = /T(\d+)(?:\s*[〜~-]\s*T(\d+))?/g;
// 「タスク分解」節の固定書式(`TODO.md` の T1〜T6 / 段階 1: T1〜T6)の直後に並ぶ T の列だけを読む。
// 同じ節の散文は「既存の T19 が担う」のように他の計画の T を名指しするため、節全体の T は拾わない
const BREAKDOWN_LIST = /(?:`TODO\.md`\s*の|段階\s*\d+[^::\n]*[::])\s*((?:T\d+(?:\s*[〜~-]\s*T\d+)?(?:\s*[,、]\s*)?)+)/g;

// `T42〜T71, T120` の表記を T 番号の集合へ展開する
export function expandTaskIds(text) {
  const ids = new Set();
  for (const match of text.matchAll(TASK_ID_OR_RANGE)) {
    const from = Number(match[1]);
    const to = match[2] === undefined ? from : Number(match[2]);
    for (let id = from; id <= to; id += 1) ids.add(id);
  }
  return ids;
}

export function breakdownTaskIds(section) {
  const ids = new Set();
  for (const match of section.matchAll(BREAKDOWN_LIST)) for (const id of expandTaskIds(match[1])) ids.add(id);
  return ids;
}

// 連続する番号は索引や設計書と同じ `T1〜T6` の書き方に縮める
export function formatIds(ids) {
  const sorted = [...ids].sort((left, right) => left - right);
  const ranges = [];
  for (const id of sorted) {
    const last = ranges.at(-1);
    if (last && id === last[1] + 1) last[1] = id;
    else ranges.push([id, id]);
  }
  return ranges.map(([from, to]) => (from === to ? `T${from}` : `T${from}〜T${to}`)).join(", ");
}

function sameSet(left, right) {
  return left.size === right.size && [...left].every((id) => right.has(id));
}

// 完了条件ブロック: 見出し行から、空行・マーカー・次のブロック見出しの手前まで
export function parseBlocks(text) {
  const blocks = new Map();
  let current = null;
  for (const line of text.split("\n")) {
    const head = line.match(BLOCK_HEAD);
    if (head) {
      current = { key: `#${head[1]}-${head[2]}`, plan: Number(head[1]), taskId: Number(head[3]), lines: [line] };
      blocks.set(current.taskId, current);
      continue;
    }
    if (current && line.trim() !== "" && !line.startsWith("<!--")) {
      current.lines.push(line);
      continue;
    }
    current = null;
  }
  for (const block of blocks.values()) block.text = block.lines.join("\n");
  return blocks;
}

export function parseTodo(text) {
  const plans = [];
  const tasks = [];
  const sections = [];
  const markers = { plan: 0, task: new Map(), block: new Map() };
  let doneColumn = null;
  let taskNameColumn = null;
  for (const [index, line] of text.split("\n").entries()) {
    const lineNumber = index + 1;
    if (PLAN_MARKER.test(line)) markers.plan += 1;
    const taskMarker = line.match(TASK_MARKER);
    if (taskMarker) markers.task.set(Number(taskMarker[1]), (markers.task.get(Number(taskMarker[1])) ?? 0) + 1);
    const blockMarker = line.match(BLOCK_MARKER);
    if (blockMarker) markers.block.set(Number(blockMarker[1]), (markers.block.get(Number(blockMarker[1])) ?? 0) + 1);
    const section = line.match(SECTION_HEADING);
    if (section) sections.push(Number(section[1]));
    // タスク表のヘッダから `実` 列とタスク名の列の位置を取る(列構成はファイル自身の表ヘッダが正)
    if (/^\|\s*#\s*\|\s*T\s*\|/.test(line)) {
      const header = cells(line);
      doneColumn = header.indexOf("実") === -1 ? null : header.indexOf("実");
      taskNameColumn = header.indexOf("タスク") === -1 ? 2 : header.indexOf("タスク");
      continue;
    }
    const plan = line.match(PLAN_ROW);
    if (plan) {
      plans.push({ number: Number(plan[1]), design: plan[3].trim(), state: plan[4], lineNumber });
      continue;
    }
    const task = line.match(TASK_ROW);
    if (task) {
      const row = cells(line);
      tasks.push({
        plan: Number(task[1]),
        index: Number(task[2]),
        taskId: Number(task[3]),
        state: task[4],
        name: row[taskNameColumn ?? 2] ?? "",
        executor: doneColumn === null ? null : row[doneColumn],
        lineNumber,
      });
    }
  }
  return { plans, tasks, sections, markers, blocks: parseBlocks(text) };
}

function readDecisionTaskIds(projectRoot) {
  const text = readIfExists(join(projectRoot, "docs", "decisions.md"));
  if (text === null) return null;
  const ids = new Set();
  for (const line of text.split("\n")) {
    if (!line.startsWith("|")) continue;
    const taskCell = cells(line)[1];
    if (taskCell) for (const id of expandTaskIds(taskCell)) ids.add(id);
  }
  return ids;
}

function readDesigns(projectRoot) {
  const designDir = join(projectRoot, "docs", "design");
  const designs = new Map();
  if (!existsSync(designDir)) return designs;
  for (const name of readdirSync(designDir)) {
    if (!name.endsWith(".md") || name === "index.md") continue;
    const text = readFileSync(join(designDir, name), "utf8");
    const breakdownSection = text.split(/^## タスク分解\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    designs.set(name, {
      title: text.match(/^# 設計:\s*(.+?)\s*$/m)?.[1] ?? null,
      breakdownIds: breakdownTaskIds(breakdownSection),
      hasUndecomposedStage: UNDECOMPOSED_STAGE.test(breakdownSection),
    });
  }
  return designs;
}

function readIndexRows(projectRoot) {
  const text = readIfExists(join(projectRoot, "docs", "design", "index.md"));
  if (text === null) return null;
  // 冒頭の規約コメントには列の記述例(`T1〜T6` 等)があり、実データとして拾わないよう除く
  const body = text.replace(/<!--[\s\S]*?-->/g, "");
  const rows = [];
  for (const line of body.split("\n")) {
    const link = line.match(/\[[^\]]*\]\(([^)]+\.md)\)/);
    if (!line.startsWith("|") || !link) continue;
    const row = cells(line);
    rows.push({ file: link[1], title: row[3] ?? "", taskColumn: row[4] ?? "" });
  }
  return rows;
}

function readBaseTodo(projectRoot, base) {
  try {
    return execFileSync("git", ["-C", projectRoot, "show", `${base}:TODO.md`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    throw new Error(`git show ${base}:TODO.md を読めない`);
  }
}

// 検出は add(check, message) で渡す。check は各コマンドの文章が名指しする検査名
export function checkTodo(projectRoot, todoText, { base = null, add }) {
  const archivePaths = ARCHIVE_CANDIDATES.filter((path) => existsSync(join(projectRoot, path)));
  const archive = parseTodo(archivePaths.map((path) => readFileSync(join(projectRoot, path), "utf8")).join("\n"));
  const todo = parseTodo(todoText);
  const newFormat = todo.markers.plan > 0 || todo.markers.task.size > 0;
  const definesAbolished = (leadingComment(todoText)?.text ?? "").includes("[-]");

  if (!/^##\s*§0/m.test(todoText)) add("section0", "§0 セッションプロトコルの見出しが無い");

  const allTasks = [...todo.tasks, ...archive.tasks];
  const seenIds = new Map();
  for (const task of allTasks) seenIds.set(task.taskId, (seenIds.get(task.taskId) ?? 0) + 1);
  for (const [taskId, count] of seenIds) if (count > 1) add("task-id-unique", `T${taskId} のタスク行が ${count} 行ある(TODO.md と archive の合計)`);
  const knownIds = new Set(seenIds.keys());

  if (newFormat) {
    if (todo.markers.plan !== 1) add("markers", `計画テーブルの追記位置マーカーが ${todo.markers.plan} 本(1 本が正)`);
    for (const plan of new Set(todo.sections)) {
      for (const [kind, counts] of [["タスク", todo.markers.task], ["完了条件", todo.markers.block]]) {
        const count = counts.get(plan) ?? 0;
        if (count !== 1) add("markers", `#${plan} の追記位置マーカー(${kind})が ${count} 本(1 本が正)`);
      }
    }
    const rowKeys = new Map(todo.tasks.map((task) => [`#${task.plan}-${task.index} / T${task.taskId}`, task]));
    const blockKeys = new Set([...todo.blocks.values()].map((block) => `${block.key} / T${block.taskId}`));
    for (const key of rowKeys.keys()) if (!blockKeys.has(key)) add("row-block-pairing", `${key} のタスク行に対応する完了条件ブロックが無い`);
    for (const key of blockKeys) if (!rowKeys.has(key)) add("row-block-pairing", `${key} の完了条件ブロックに対応するタスク行が無い`);

    const indexesByPlan = new Map();
    for (const task of allTasks) indexesByPlan.set(task.plan, [...(indexesByPlan.get(task.plan) ?? []), task.index]);
    for (const [plan, indexes] of indexesByPlan) {
      const duplicates = indexes.filter((value, position) => indexes.indexOf(value) !== position);
      if (duplicates.length > 0) add("plan-index-order", `#${plan} で #${plan}-${[...new Set(duplicates)].join(`, #${plan}-`)} が重複している`);
      const inTodo = todo.tasks.filter((task) => task.plan === plan).map((task) => task.index);
      if (inTodo.some((value, position) => position > 0 && value <= inTodo[position - 1])) add("plan-index-order", `#${plan} のタスク行が #<n>-<m> の昇順に並んでいない`);
    }
    const tableNumbers = new Set(todo.plans.map((plan) => plan.number));
    const sectionNumbers = new Set(todo.sections);
    for (const number of tableNumbers) if (!sectionNumbers.has(number)) add("plan-sections", `計画テーブルの #${number} に対応するセクション見出し(## #${number})が無い`);
    for (const number of sectionNumbers) if (!tableNumbers.has(number)) add("plan-sections", `セクション見出し ## #${number} に対応する計画テーブルの行が無い`);
  }

  const designs = readDesigns(projectRoot);
  for (const plan of todo.plans) {
    const designName = plan.design.replace(/^docs\/design\//, "");
    const design = designs.get(designName);
    if (!design) {
      add("design-pointer", `計画 #${plan.number} が指す ${plan.design} が無い`);
      continue;
    }
    const children = allTasks.filter((task) => task.plan === plan.number);
    const childIds = new Set(children.map((task) => task.taskId));
    if (childIds.size > 0 && !sameSet(childIds, design.breakdownIds)) {
      add("design-breakdown", `${plan.design} の「タスク分解」節の T(${formatIds(design.breakdownIds) || "なし"})が計画 #${plan.number} のタスク(${formatIds(childIds)})と一致しない`);
    }
    if (children.length === 0) continue;
    const settled = children.every((task) => task.state !== " ");
    const anyDone = children.some((task) => task.state === "x");
    if (definesAbolished) {
      const expected = design.hasUndecomposedStage || !settled ? " " : anyDone ? "x" : "-";
      if (plan.state !== expected) {
        const reason = design.hasUndecomposedStage ? "(設計書に `段階 <n>: 未分解` が残る)" : "";
        add("plan-state", `計画 #${plan.number} の状態が [${plan.state}](配下の状態からは [${expected}] が正${reason})`);
      }
    } else if (plan.state === " " && children.every((task) => task.state === "x") && !design.hasUndecomposedStage) {
      add("plan-state", `計画 #${plan.number} は配下が全て [x] なのに [ ] のまま`);
    }
  }

  const decisionIds = readDecisionTaskIds(projectRoot);
  for (const task of todo.tasks) {
    if (task.state === "x" && task.executor === "—") add("executor-column", `T${task.taskId} は [x] なのに 実 列が — のまま`);
    if (task.state !== "-") continue;
    if (!ABOLISHED_NAME.test(task.name)) add("abolished", `T${task.taskId} は [-] なのにタスク名の末尾に (廃止: …) が無い`);
    if (decisionIds !== null && !decisionIds.has(task.taskId)) add("abolished", `T${task.taskId} は [-] なのに docs/decisions.md にその T の行が無い`);
  }
  for (const block of todo.blocks.values()) {
    for (const origin of block.text.matchAll(ORIGIN_TAG)) {
      if (!knownIds.has(Number(origin[1]))) add("origin-tag", `T${block.taskId} の由来 T${origin[1]} が TODO.md にも archive にも無い`);
    }
  }

  const indexRows = readIndexRows(projectRoot);
  if (indexRows !== null) {
    const listed = new Set(indexRows.map((row) => row.file));
    for (const name of designs.keys()) if (!listed.has(name)) add("design-index", `索引に ${name} の行が無い`);
    const plannedDesigns = new Set(todo.plans.map((plan) => plan.design.replace(/^docs\/design\//, "")));
    for (const row of indexRows) {
      const design = designs.get(row.file);
      if (!design) {
        add("design-index", `索引の ${row.file} の実体が無い`);
        continue;
      }
      if (design.title !== null && row.title !== design.title) add("design-index", `索引の ${row.file} の表題「${row.title}」が設計書の「${design.title}」と違う`);
      const indexIds = expandTaskIds(row.taskColumn);
      if (indexIds.size === 0 && plannedDesigns.has(row.file)) add("design-index", `索引の ${row.file} の T 列が — だが TODO.md に計画行がある`);
      if (indexIds.size > 0 && !sameSet(indexIds, design.breakdownIds)) add("design-index", `索引の ${row.file} の T 列(${formatIds(indexIds)})が設計書の「タスク分解」節(${formatIds(design.breakdownIds) || "なし"})と違う`);
    }
  }

  let changedBlocks = null;
  if (base !== null) {
    const before = parseTodo(readBaseTodo(projectRoot, base));
    const beforeStates = new Map(before.tasks.map((task) => [task.taskId, task.state]));
    changedBlocks = [];
    for (const [taskId, block] of todo.blocks) {
      const previous = before.blocks.get(taskId);
      const becameAbolished = beforeStates.get(taskId) !== undefined && beforeStates.get(taskId) !== "-" && todo.tasks.find((task) => task.taskId === taskId)?.state === "-";
      if ((previous && previous.text !== block.text) || becameAbolished) changedBlocks.push(taskId);
    }
    for (const taskId of changedBlocks) {
      if (decisionIds === null || !decisionIds.has(taskId)) add("decisions-for-changes", `T${taskId} の完了条件ブロックまたは状態が ${base} から変わったのに docs/decisions.md にその T の行が無い`);
    }
  }

  return { newFormat, changedBlocks, taskStates: new Map(allTasks.map((task) => [task.taskId, task.state])) };
}
