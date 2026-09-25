import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { checkArchitecture } from "./architecture.mjs";
import { checkBudget } from "./budget.mjs";
import { checkDecisions } from "./decisions.mjs";
import { checkDesignPointer } from "./design-pointer.mjs";
import { checkHandoff } from "./handoff.mjs";
import { readIfExists } from "./markdown.mjs";
import { checkTodo, formatIds } from "./todo.mjs";

// 冒頭の規約コメントに自分の書式規約を持つ文書(HANDOFF.md・TODO.md・docs/design/*.md・
// docs/architecture.md・docs/decisions.md。hooks/check-header-comment.mjs が守る範囲と同じ)が、
// その規約どおりに書かれているかを機械的に検査する。呼び出し元は commands/breakdown.md・amend.md・
// follow-up.md の機械チェック。判断を要する検査(未定義の省略ID、決定表との矛盾、コールドスタート、
// 要確認が決着済みか、平置きの違反か)はここに入れず、各コマンドの文章に残す。
// 無い文書はその文書の検査を省く(単発モードのプロジェクトは HANDOFF.md や TODO.md を持たない)

function designFiles(projectRoot) {
  const designDir = join(projectRoot, "docs", "design");
  if (!existsSync(designDir)) return [];
  return readdirSync(designDir).filter((name) => name.endsWith(".md")).sort();
}

export function checkProject(projectRoot, { base = null } = {}) {
  const findings = [];
  const add = (check, message) => findings.push({ check, message });
  const read = (path) => readIfExists(join(projectRoot, path));
  const documents = new Map(
    ["TODO.md", "HANDOFF.md", "docs/architecture.md", "docs/decisions.md", ...designFiles(projectRoot).map((name) => `docs/design/${name}`)]
      .map((path) => [path, read(path)])
      .filter(([, text]) => text !== null),
  );
  if (documents.size === 0) throw new Error("検査対象の文書(TODO.md・HANDOFF.md・docs/ の設計書など)が無い");

  for (const [path, text] of documents) checkBudget(path, text, add);

  let todo = null;
  if (documents.has("TODO.md")) todo = checkTodo(projectRoot, documents.get("TODO.md"), { base, add });
  if (documents.has("HANDOFF.md")) checkHandoff(documents.get("HANDOFF.md"), todo?.taskStates ?? null, add);
  const planText = read("plan.md");
  for (const [path, text] of documents) {
    if (path.startsWith("docs/design/") && path !== "docs/design/index.md") checkDesignPointer(path, text, planText, add);
  }
  if (documents.has("docs/architecture.md")) checkArchitecture(projectRoot, documents.get("docs/architecture.md"), add);
  if (documents.has("docs/decisions.md")) checkDecisions(projectRoot, { base, add });

  return { checked: [...documents.keys()], todoFormat: todo === null ? null : todo.newFormat ? "new" : "old", findings, changedBlocks: todo?.changedBlocks ?? null };
}

export function render(result, { base = null } = {}) {
  const designs = result.checked.filter((path) => path.startsWith("docs/design/")).length;
  const others = result.checked.filter((path) => !path.startsWith("docs/design/"));
  const lines = [`checked: ${[...others, ...(designs > 0 ? [`docs/design/*.md(${designs} 件)`] : [])].join(", ")}`];
  if (result.todoFormat !== null) lines.push(`todo_format: ${result.todoFormat}`);
  for (const finding of result.findings) lines.push(`NG ${finding.check}: ${finding.message}`);
  if (base !== null && result.changedBlocks !== null) lines.push(`changed_since_base(${base}): ${formatIds(new Set(result.changedBlocks)) || "なし"}`);
  lines.push(result.findings.length === 0 ? "result: ok" : `result: ng ${result.findings.length}`);
  return lines.join("\n");
}
