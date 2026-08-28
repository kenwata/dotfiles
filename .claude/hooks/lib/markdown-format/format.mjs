import { scanDocument } from "./scan.mjs";
import { scanInline } from "./inline.mjs";
import { applyEdits, isWordChar } from "./text-util.mjs";

// インライン装飾のスペース挿入対象になる行種(fence 内・インデント式 code・
// frontmatter・table delimiter は対象外)
const INLINE_KINDS = new Set(["text", "table-row"]);

// strong/emphasis/delete/inlineCode/inlineMath の外側に、隣接文字が
// かな・漢字・半角英数字のときだけ半角スペースを挿入する(全角約物側には触れない)。
function decorationSpacingEdits(doc) {
  const edits = [];
  doc.lines.forEach((line, idx) => {
    if (!INLINE_KINDS.has(line.kind)) return;
    const lineStart = doc.lineStarts[idx];
    const { spans } = scanInline(line.raw);
    for (const span of spans) {
      const before = span.start > 0 ? line.raw[span.start - 1] : "";
      if (isWordChar(before)) {
        edits.push({ start: lineStart + span.start, end: lineStart + span.start, replacement: " " });
      }
      const after = line.raw[span.end] ?? "";
      if (isWordChar(after)) {
        edits.push({ start: lineStart + span.end, end: lineStart + span.end, replacement: " " });
      }
    }
  });
  return edits;
}

// 4 backticks 以上への昇格と、開始・終了 fence の backtick 数の一致を保証する。
// 対象: backtick fence・閉じあり・blockquote 外・開始/終了とも絶対 indent <= 3
// (深いネストや blockquote 内は remark 版と同じく触らない)。
// 閉じ fence が見つからない(欠落・不整形)場合は自動修正せず lint.mjs に委ねる。
function fenceEdits(doc, fence) {
  if (
    fence.marker !== "`" ||
    fence.closeLine === null ||
    fence.bqDepth !== 0 ||
    fence.absIndent > 3 ||
    fence.closeAbsIndent > 3
  ) {
    return [];
  }

  let maxRun = 0;
  for (let i = fence.openIdx + 1; i < fence.closeLine; i++) {
    for (const m of doc.lines[i].raw.matchAll(/`+/g)) {
      if (m[0].length > maxRun) maxRun = m[0].length;
    }
  }
  const target = Math.max(4, maxRun + 1, fence.runLen);
  if (fence.runLen === target && fence.closeRunLen === target) return [];

  const edits = [];
  const openRun = doc.lines[fence.openIdx].raw.match(/`{3,}/);
  edits.push({
    start: doc.lineStarts[fence.openIdx] + openRun.index,
    end: doc.lineStarts[fence.openIdx] + openRun.index + fence.runLen,
    replacement: "`".repeat(target),
  });
  const closeRun = doc.lines[fence.closeLine].raw.match(/`{3,}/);
  edits.push({
    start: doc.lineStarts[fence.closeLine] + closeRun.index,
    end: doc.lineStarts[fence.closeLine] + closeRun.index + fence.closeRunLen,
    replacement: "`".repeat(target),
  });
  return edits;
}

// トップレベル(list/blockquote 外)の fenced code block の前後に空行を入れる。
// list/blockquote 内では字下げの意味が変わりうるため対象外にする。
// インデント式 code block も対象外(remark 版からの意図的変更 — README.md 参照)。
function fenceBlankLineEdits(doc, fence) {
  if (!fence.atRoot) return [];
  const edits = [];

  if (fence.openIdx > 0 && doc.lines[fence.openIdx - 1].kind !== "blank") {
    const at = doc.lineStarts[fence.openIdx];
    edits.push({ start: at, end: at, replacement: "\n" });
  }

  if (fence.closeLine !== null && fence.closeLine + 1 < doc.lines.length) {
    if (doc.lines[fence.closeLine + 1].kind !== "blank") {
      const at = doc.lineStarts[fence.closeLine + 1];
      edits.push({ start: at, end: at, replacement: "\n" });
    }
  }

  return edits;
}

export function formatMarkdown(source) {
  const doc = scanDocument(source);
  const edits = [...decorationSpacingEdits(doc)];
  for (const fence of doc.fences) {
    edits.push(...fenceEdits(doc, fence));
    edits.push(...fenceBlankLineEdits(doc, fence));
  }
  return applyEdits(source, edits);
}
