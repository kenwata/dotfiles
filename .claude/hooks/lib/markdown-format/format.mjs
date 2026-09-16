import { partAt, scanDocument, tableRowSegments, textParagraphs } from "./scan.mjs";
import { scanInline } from "./inline.mjs";
import { applyEdits, isWordChar } from "./text-util.mjs";
import { lineInScope, rangeInScope, translateLineRanges } from "./scope.mjs";

// 1 セグメント(text 行なら段落全体、table-row 行なら 1 セル)分の scanInline 結果から、
// 装飾の外側にスペースを入れる位置(セグメント内オフセット)を返す。
function spacingOffsets(segText) {
  const { spans } = scanInline(segText);
  const offsets = [];
  for (const span of spans) {
    if (isWordChar(segText[span.start - 1])) offsets.push(span.start);
    if (isWordChar(segText[span.end])) offsets.push(span.end);
  }
  return offsets;
}

function insertSpaceAt(offset) {
  return { start: offset, end: offset, replacement: " " };
}

// strong/emphasis/delete/inlineCode/inlineMath の外側に、隣接文字が
// かな・漢字・半角英数字のときだけ半角スペースを挿入する(全角約物側には触れない)。
// table-row 行は GFM のインライン解析がセル単位で行われるのに合わせ、セルごとに
// 区切って走査する(行全体を 1 本として走査すると、別セルの装飾記号と誤って
// 対応付けられ、成立した span の内側にスペースが入る事故が起きる)。
// text 行は段落単位で走査する(行をまたぐ code span を 1 つとして扱うため)。段落の
// 一部だけが範囲内の場合も段落全体を走査し、範囲内の行に落ちる挿入だけを残す。
// fence 内・インデント式 code・frontmatter・table delimiter は対象外。
function decorationSpacingEdits(doc, lineRanges) {
  const paragraphEdits = textParagraphs(doc).flatMap((paragraph) =>
    spacingOffsets(paragraph.text)
      .map((offset) => ({ offset, part: partAt(paragraph, offset) }))
      .filter(({ part }) => lineInScope(lineRanges, part.lineIdx))
      .map(({ offset, part }) => insertSpaceAt(part.absStart + offset - part.textStart)),
  );

  const tableEdits = doc.lines.flatMap((line, idx) => {
    if (line.kind !== "table-row" || !lineInScope(lineRanges, idx)) return [];
    const contentStart = doc.lineStarts[idx] + line.contentStart;
    const content = line.raw.slice(line.contentStart);
    return tableRowSegments(content).flatMap((seg) =>
      spacingOffsets(content.slice(seg.start, seg.end)).map((offset) =>
        insertSpaceAt(contentStart + seg.start + offset),
      ),
    );
  });

  return [...paragraphEdits, ...tableEdits];
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

// lineRanges(Set<number>、0-indexed 行インデックス)を渡すと、装飾スペース・fence
// 系の edit をその範囲と交差するものだけに限定する(未指定なら全行が対象。
// scope.mjs 参照 — PostToolUse hook の Edit スコープ限定に使う)。
//
// 戻り値の lineRanges は、挿入された空行の分だけ行インデックスを補正した後の
// 集合(呼び出し側は、整形後のテキストに対して lintMarkdown を呼ぶ際にこちらを
// 使う。整形前基準の元の lineRanges をそのまま使うと、空行挿入より後ろの行が
// ずれて検出が脱落・誤帰属する)。lineRanges 未指定なら常に undefined。
export function formatMarkdown(source, { lineRanges } = {}) {
  const doc = scanDocument(source);
  const edits = [...decorationSpacingEdits(doc, lineRanges)];
  for (const fence of doc.fences) {
    const fenceEnd = fence.closeLine ?? doc.lines.length - 1;
    if (!rangeInScope(lineRanges, fence.openIdx, fenceEnd)) continue;
    edits.push(...fenceEdits(doc, fence));
    edits.push(...fenceBlankLineEdits(doc, fence));
  }

  // 行を増やす edit(純粋挿入かつ replacement が丸ごと "\n")だけを行インデックスへ
  // 逆引きする。生成元を名指ししない判定なので新しい edit 種別が増えても自然に
  // 拾えるが、次の前提には依存している: 挿入位置が既存の行頭(doc.lineStarts の
  // 値)と一致すること、replacement に改行を複数含む・複数行を差し替える edit が
  // 無いこと。現状の 3 系統(スペース挿入・fence 内 backtick 置換・fence 前後への
  // 空行挿入)はいずれも満たす。
  const insertionBoundaries = new Set();
  if (lineRanges) {
    const lineStartToIndex = new Map(doc.lineStarts.map((s, i) => [s, i]));
    for (const edit of edits) {
      if (edit.start === edit.end && edit.replacement === "\n") {
        const idx = lineStartToIndex.get(edit.start);
        if (idx !== undefined) insertionBoundaries.add(idx);
      }
    }
  }

  const result = applyEdits(source, edits);
  return { ...result, lineRanges: translateLineRanges(lineRanges, insertionBoundaries) };
}
