#!/usr/bin/env node
import { resolve } from "node:path";
import { checkProject, render } from "./check.mjs";

// 呼び出し規約(commands/breakdown.md・amend.md・follow-up.md と templates/BLUEPRINT.md §6 から呼ばれる):
//   node ~/.claude/hooks/lib/markdown-header-rule-check/cli.mjs [プロジェクトルート(省略時はカレント)] [--base <rev>]
//   --base を渡すと、その版から完了条件ブロックが変わった T と [-] にした T を列挙してそれぞれに
//   docs/decisions.md の行があるかを、あわせて docs/decisions.md が追記だけで変わったかを検査する
//   (/amend は HEAD を、/follow-up は基準の checkpoint を渡す)。
// 出力規約: 1 行目 `checked: <検査した文書>`、TODO.md があれば `todo_format: new|old`、検出ごとに
//   `NG <検査名>: <内容>`、--base 時は `changed_since_base(<rev>): <T の一覧|なし>`、
//   最終行 `result: ok` または `result: ng <件数>`。
// 終了コード: 検出なし 0 / 検出あり 1 / 検査できない(対象の文書が 1 つも無い、--base の版を読めない)2。
const args = process.argv.slice(2);
const baseIndex = args.indexOf("--base");
const base = baseIndex === -1 ? null : args[baseIndex + 1];
const root = (baseIndex === -1 ? args : args.filter((_, index) => index !== baseIndex && index !== baseIndex + 1))[0] ?? ".";

if (baseIndex !== -1 && !base) {
  console.error("markdown-header-rule-check: --base には版を渡す");
  process.exit(2);
}
try {
  const result = checkProject(resolve(root), { base });
  console.log(render(result, { base }));
  process.exit(result.findings.length === 0 ? 0 : 1);
} catch (error) {
  console.error(`markdown-header-rule-check: ${error.message}`);
  process.exit(2);
}
