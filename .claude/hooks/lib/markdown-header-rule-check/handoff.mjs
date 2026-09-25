import { leadingComment, sectionLines } from "./markdown.mjs";

// HANDOFF.md の「要確認」: 各行の先頭に固定書式の回収点があるか、回収点の T がまだ未着手か。
// 規約の正は ~/.claude/templates/skeletons/handoff.md の冒頭コメント。ファイルは自身の冒頭コメントが
// 定める形式に従うので、回収点を定義していない旧規約の HANDOFF.md は検査しない。項目が既に決着して
// いるかは判断を要するので検査しない(/follow-up の機械チェック③の残りは文章側)
const PENDING_HEADING = /^##\s*要確認/;
const COLLECTION_POINT = /^-\s*\[回収[::]\s*(?:T(\d+)\s*着手前|次の\s*\/follow-up)\]/;

export function checkHandoff(text, taskStates, add) {
  if (!(leadingComment(text)?.text ?? "").includes("回収点")) return;
  const items = (sectionLines(text, PENDING_HEADING) ?? []).filter((line) => /^-\s/.test(line));
  for (const item of items) {
    if (/^-\s*なし/.test(item)) continue;
    const point = item.match(COLLECTION_POINT);
    const excerpt = item.length > 60 ? `${item.slice(0, 60)}…` : item;
    if (!point) {
      add("handoff-pending", `要確認の行の先頭に回収点([回収: T<n> 着手前] か [回収: 次の /follow-up])が無い: ${excerpt}`);
      continue;
    }
    if (point[1] === undefined || taskStates === null) continue;
    const state = taskStates.get(Number(point[1]));
    if (state === undefined) add("handoff-pending", `要確認の回収点 T${point[1]} が TODO.md にも archive にも無い: ${excerpt}`);
    else if (state !== " ") add("handoff-pending", `要確認の回収点 T${point[1]} は既に [${state}](問われないまま着手・廃止された): ${excerpt}`);
  }
}
