import { existsSync, readFileSync } from "node:fs";

// 検査対象の文書に共通する読み取りの部品

export function readIfExists(path) {
  return existsSync(path) ? readFileSync(path, "utf8") : null;
}

// 表の行をセルに分ける。`\|` はセル内の縦棒なので区切りにしない(GFM と同じ)
export function cells(line) {
  return line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim());
}

// 末尾の改行で終わる行を 1 行と数える(wc -l と同じ)
export function lineCount(text) {
  const lines = text.split("\n");
  return lines.at(-1) === "" ? lines.length - 1 : lines.length;
}

// 冒頭の規約コメント: 最初の本文行(空行と見出し以外)より前に始まる `<!-- … -->` 塊。
// HANDOFF.md のように見出しの後に置く形もある(hooks/check-header-comment.mjs と同じ定義)
export function leadingComment(text) {
  const lines = text.split("\n");
  for (const [index, line] of lines.entries()) {
    if (line.trim() === "" || line.startsWith("#")) continue;
    if (!line.trimStart().startsWith("<!--")) return null;
    const end = lines.findIndex((candidate, position) => position >= index && candidate.includes("-->"));
    if (end === -1) return null;
    return { text: lines.slice(index, end + 1).join("\n"), lineCount: end - index + 1 };
  }
  return null;
}

// `## 見出し` から、同じか上の階層の次の見出しの手前までの本文の行
export function sectionLines(text, headingPattern) {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => headingPattern.test(line));
  if (start === -1) return null;
  const level = lines[start].match(/^#+/)[0].length;
  const end = lines.findIndex((line, index) => index > start && /^#+\s/.test(line) && line.match(/^#+/)[0].length <= level);
  return lines.slice(start + 1, end === -1 ? undefined : end);
}
