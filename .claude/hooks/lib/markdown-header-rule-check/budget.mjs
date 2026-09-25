import { leadingComment, lineCount } from "./markdown.mjs";

// 行数予算: 冒頭の規約コメントが宣言する上限(「行数予算: 80 行」「40行以内」)と実際の行数を比べる。
// 既定はファイル全体の行数(規約コメントを含む)。コメントが「規約コメントを除いた本文」を数えると
// 宣言していれば(HANDOFF.md)、本文だけを数える。予算の宣言が無い文書は検査しない
const BUDGET = /行数予算[::]\s*(\d+)\s*行|(\d+)\s*行以内/;
const EXCLUDES_COMMENT = /コメントを除いた/;

export function checkBudget(name, text, add) {
  const comment = leadingComment(text);
  const declared = comment?.text.match(BUDGET);
  if (!declared) return;
  const limit = Number(declared[1] ?? declared[2]);
  const excludesComment = EXCLUDES_COMMENT.test(comment.text);
  const count = lineCount(text) - (excludesComment ? comment.lineCount : 0);
  if (count > limit) {
    add("line-budget", `${name} が ${count} 行(${excludesComment ? "規約コメントを除いた本文、" : ""}予算 ${limit} 行)`);
  }
}
