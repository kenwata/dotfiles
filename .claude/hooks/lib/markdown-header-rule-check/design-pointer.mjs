import { leadingComment } from "./markdown.mjs";

// 設計書の「全体構想」行: 固定書式 `全体構想: plan.md §<節番号> / <フェーズ見出しの逐語>` か
// `全体構想: なし` であること、指す節とフェーズ見出しの両方が plan.md に実在すること。
// 規約の正は ~/.claude/templates/skeletons/design.md の冒頭コメント。
// plan.md の節見出しは `## §9 …`・`## 9. …`・`# 9. …` のどれもが実在するので、どれも受ける
const POINTER_LINE = /^全体構想[::].*$/m;
const POINTER = /^全体構想:\s*(?:なし|plan\.md §(\d+) \/ (.+?))\s*$/;
const HEADING = /^(#+)\s+(.*?)\s*$/;
const NUMBERED = /^(?:§\s*)?(\d+)(?:[.．]\s*|\s+|$)(.*)$/;

function parseHeadings(planText) {
  return planText
    .split("\n")
    .map((line) => line.match(HEADING))
    .filter(Boolean)
    .map((match) => ({ level: match[1].length, text: match[2] }));
}

export function checkDesignPointer(name, designText, planText, add) {
  // ファイルは自身の冒頭コメントが定める形式に従うので、「全体構想」行を定義していない旧規約の設計書は検査しない
  if (!(leadingComment(designText)?.text ?? "").includes("全体構想")) return;
  const line = designText.match(POINTER_LINE)?.[0];
  if (line === undefined) {
    add("design-pointer-format", `${name} に「全体構想」行が無い`);
    return;
  }
  const pointer = line.match(POINTER);
  if (!pointer) {
    add("design-pointer-format", `${name} の「全体構想」行が固定書式でない(節番号止まりの旧書式を含む): ${line}`);
    return;
  }
  if (pointer[1] === undefined) return;
  if (planText === null) {
    add("design-pointer-target", `${name} は plan.md を指すが plan.md が無い`);
    return;
  }
  const headings = parseHeadings(planText);
  const start = headings.findIndex((heading) => heading.text.match(NUMBERED)?.[1] === pointer[1]);
  if (start === -1) {
    add("design-pointer-target", `${name} が指す plan.md §${pointer[1]} の見出しが plan.md に無い`);
    return;
  }
  const end = headings.findIndex((heading, index) => index > start && heading.level <= headings[start].level);
  const section = headings.slice(start, end === -1 ? undefined : end);
  // 節の見出し自身がフェーズ名のこともある(`## 3. 初期範囲と非対象` を `§3 / 初期範囲と非対象` と指す)
  const titles = section.flatMap((heading, index) => (index === 0 ? [heading.text, heading.text.match(NUMBERED)[2]] : [heading.text]));
  if (!titles.includes(pointer[2])) {
    add("design-pointer-target", `${name} が指すフェーズ見出し「${pointer[2]}」が plan.md §${pointer[1]} の中に無い`);
  }
}
