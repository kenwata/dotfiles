#!/usr/bin/env node
import { resolve } from "node:path";
import { measure, render } from "./gauge.mjs";

// 呼び出し規約(commands/breakdown.md から呼ばれる。Codex 側も同じ絶対パスで呼ぶ):
//   node ~/.claude/hooks/lib/mainline-gauge/cli.mjs [プロジェクトルート(省略時はカレント)]
// 出力規約:
//   - plan.md に `本流: §<節番号>` の宣言が無い、TODO.md が無い、git 管理外、のいずれかなら
//     何も出力せず exit 0(計器の対象外のプロジェクト)。
//   - 宣言はあるが計測できない場合(TODO.md や計画テーブルが無い、git の履歴を読めない)は、
//     理由を 1 行で出す(対象外の無出力と区別するため)。
//   - 対象なら計器を stdout に出す。最終行は機械判定用の
//     `consecutive_side_breakdown: yes|no`(yes = 支線のタスクが最後に採番された時点より後に、
//     本流の完了が無い)。
//   - いかなる場合も exit 0(計器は分解を止めない。止めるかどうかは利用者が選ぶ)。
try {
  const measurement = measure(resolve(process.argv[2] ?? "."));
  if (measurement !== null) console.log(render(measurement));
} catch (error) {
  console.error(`mainline-gauge: ${error.message}`);
}
process.exit(0);
