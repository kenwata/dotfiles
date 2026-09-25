import { execFileSync } from "node:child_process";
import { cells } from "./markdown.mjs";

// docs/decisions.md は追記専用。--base を渡された時だけ、基準の版から削除・書き換えた行が無いことと、
// 足した表の行が 4 列(日付 / タスクID / 判断内容 / 理由)で日付が YYYY-MM-DD であることを検査する。
// 表の後ろに別の節を持つファイルもあるので、追記はファイル末尾とは限らない(表の末尾に足す)。
// 既存の行は直せない(追記専用)ので、その書式は検査しない。タスクID列の範囲表記(`T36〜T42`)も同じ
// 理由で検査しない。規約の正は ~/.claude/templates/skeletons/decisions.md の冒頭コメント
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function checkDecisions(projectRoot, { base, add }) {
  if (base === null) return;
  let diff;
  try {
    diff = execFileSync("git", ["-C", projectRoot, "diff", "--unified=0", base, "--", "docs/decisions.md"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch {
    return; // 基準の版を読めない場合は TODO.md 側の --base の検査が理由を出す
  }
  const lines = diff.split("\n").filter((line) => !line.startsWith("+++") && !line.startsWith("---"));
  if (lines.some((line) => line.startsWith("-"))) {
    add("decisions-append-only", `docs/decisions.md の既存の行が ${base} から削除・書き換えされている(追記専用)`);
  }
  const appended = lines.filter((line) => line.startsWith("+|")).map((line) => line.slice(1)).filter((line) => !/^\|[\s|:-]+\|?\s*$/.test(line));
  for (const row of appended) {
    const columns = cells(row);
    if (columns[0] === "日付") continue;
    const excerpt = row.length > 60 ? `${row.slice(0, 60)}…` : row;
    if (columns.length !== 4) add("decisions-row", `追記した行の列が ${columns.length} 個(4 個が正。セル内の縦棒は \\| と書く): ${excerpt}`);
    else if (!DATE.test(columns[0])) add("decisions-row", `追記した行の日付が YYYY-MM-DD でない: ${excerpt}`);
  }
}
