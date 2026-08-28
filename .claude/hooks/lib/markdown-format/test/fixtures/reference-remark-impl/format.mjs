import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";
import {
  applyEdits,
  isBlankRange,
  isWordChar,
  lineStartOffset,
  nextLineStartOffset,
} from "./text-util.mjs";

const DECORATION_TYPES = new Set([
  "strong",
  "emphasis",
  "delete",
  "inlineCode",
  "inlineMath",
]);

function parseTree(source) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .parse(source);
}

// strong/emphasis/delete/inlineCode/inlineMath の外側に、隣接文字が
// かな・漢字・半角英数字のときだけ半角スペースを挿入する(全角約物側には触れない)。
function decorationSpacingEdits(source, node) {
  const edits = [];
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return edits;

  const before = start > 0 ? source[start - 1] : "";
  if (isWordChar(before)) {
    edits.push({ start, end: start, replacement: " " });
  }

  const after = end < source.length ? source[end] : "";
  if (isWordChar(after)) {
    edits.push({ start: end, end, replacement: " " });
  }

  return edits;
}

function maxBacktickRun(text) {
  let max = 0;
  for (const m of text.matchAll(/`+/g)) {
    if (m[0].length > max) max = m[0].length;
  }
  return max;
}

// 4 backticks 以上への昇格と、開始・終了 fence の backtick 数の一致を保証する。
// 閉じ fence が見つからない(欠落・不整形)場合は自動修正せず lint.mjs に委ねる。
function fenceEdits(source, node) {
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return [];

  const blockText = source.slice(start, end);
  const lines = blockText.split("\n");
  const openMatch = lines[0].match(/^([ \t]{0,3})(`{3,})(.*)$/);
  if (!openMatch) return []; // インデント式 or tilde fence(本規則の対象外)

  const closeMatch = lines[lines.length - 1].match(/^([ \t]{0,3})(`{3,})[ \t]*$/);
  if (!closeMatch) return []; // 欠落・不整形は linter 側で検出

  const openCount = openMatch[2].length;
  const closeCount = closeMatch[2].length;
  const requiredByContent = maxBacktickRun(node.value ?? "") + 1;
  const minimum = Math.max(4, requiredByContent);
  const target = Math.max(minimum, openCount);

  if (openCount === target && closeCount === target) return [];

  const newLines = [...lines];
  newLines[0] = openMatch[1] + "`".repeat(target) + openMatch[3];
  newLines[newLines.length - 1] = closeMatch[1] + "`".repeat(target);

  return [{ start, end, replacement: newLines.join("\n") }];
}

// トップレベル(root 直下)の fenced code block の前後に空行を入れる。
// list/blockquote 内では字下げの意味が変わりうるため対象外にする。
function fenceBlankLineEdits(source, node) {
  const edits = [];
  const start = node.position?.start?.offset;
  const end = node.position?.end?.offset;
  if (typeof start !== "number" || typeof end !== "number") return edits;

  const thisLineStart = lineStartOffset(source, start);
  if (thisLineStart > 0) {
    const prevLineEnd = thisLineStart - 1;
    const prevLineStart = lineStartOffset(source, prevLineEnd);
    if (!isBlankRange(source, prevLineStart, prevLineEnd)) {
      edits.push({ start: thisLineStart, end: thisLineStart, replacement: "\n" });
    }
  }

  const afterLineStart = nextLineStartOffset(source, end);
  if (afterLineStart < source.length) {
    const afterLineEndIdx = source.indexOf("\n", afterLineStart);
    const afterLineEnd = afterLineEndIdx === -1 ? source.length : afterLineEndIdx;
    if (!isBlankRange(source, afterLineStart, afterLineEnd)) {
      edits.push({ start: afterLineStart, end: afterLineStart, replacement: "\n" });
    }
  }

  return edits;
}

export function formatMarkdown(source) {
  const tree = parseTree(source);
  const edits = [];

  function walk(node, parent) {
    if (DECORATION_TYPES.has(node.type)) {
      edits.push(...decorationSpacingEdits(source, node));
    }
    if (node.type === "code") {
      // backtick 数の昇格・一致は list/blockquote 内でも安全(行の増減を伴わない)。
      // 空行挿入だけは字下げの意味を変え得るため root 直下の fence に限定する。
      edits.push(...fenceEdits(source, node));
      if (parent && parent.type === "root") {
        edits.push(...fenceBlankLineEdits(source, node));
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, node);
    }
  }
  walk(tree, null);

  return applyEdits(source, edits);
}
