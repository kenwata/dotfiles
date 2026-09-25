import { execFileSync } from "node:child_process";
import { sectionLines } from "./markdown.mjs";

// docs/architecture.md のツリーに、git が追跡する第 1 階層のディレクトリの記載漏れが無いか。
// 第 2 階層より下をどこまで載せるか(「src/ の構造をミラー」のような要約を含む)は書き手の判断なので
// 検査しない。平置きの違反の判定(実装ファイルか)も同じ(/follow-up の機械チェック⑦の残りは文章側)。
// 規約の正は ~/.claude/templates/skeletons/architecture.md の冒頭コメント
const TREE_HEADING = /^##\s*ディレクトリツリー/;
const TREE_ENTRY = /^((?:[│ ]\s{3})*)[├└]──\s+(\S+)/;

export function parseTree(lines) {
  const paths = new Set();
  const stack = [];
  for (const line of lines) {
    const entry = line.match(TREE_ENTRY);
    if (!entry) continue;
    const depth = entry[1].length / 4;
    stack.length = depth;
    stack.push(entry[2].replace(/\/$/, ""));
    if (!entry[2].endsWith("/")) continue;
    // `.claude/rules/` のように途中を省いた項目は、途中の各階層も載っているとみなす
    const segments = stack.join("/").split("/");
    for (let count = 1; count <= segments.length; count += 1) paths.add(segments.slice(0, count).join("/"));
  }
  return paths;
}

function trackedTopDirectories(projectRoot) {
  let files;
  try {
    files = execFileSync("git", ["-C", projectRoot, "ls-files"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null;
  }
  return new Set(files.split("\n").filter((file) => file.includes("/")).map((file) => file.split("/")[0]));
}

export function checkArchitecture(projectRoot, text, add) {
  const tree = parseTree(sectionLines(text, TREE_HEADING) ?? []);
  const tracked = trackedTopDirectories(projectRoot);
  if (tree.size === 0 || tracked === null) return;
  for (const directory of [...tracked].sort()) {
    if (!tree.has(directory)) add("architecture-tree", `git が追跡する ${directory}/ が docs/architecture.md のツリーに無い`);
  }
}
