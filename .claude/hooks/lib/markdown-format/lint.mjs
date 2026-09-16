import { partAt, scanDocument, splitTableRow, tableRowSegments, textParagraphs } from "./scan.mjs";
import { scanInline, residualMask } from "./inline.mjs";
import { lineInScope, rangeInScope } from "./scope.mjs";

const TABLE_CELL_MAX_CHARS = 40;
const LIST_MAX_DEPTH = 2;

// フォーマッタが 4 backticks 以上・開始終了一致まで直した後でも、閉じ fence 自体が
// 見つからない(欠落・不整形)ケースは意図の推定が要るため自動修正せず検出のみ行う。
// 未閉 fence は以降のパースを全体的に壊すため、fence の開き行〜ファイル末尾が編集
// 範囲と交差する限り報告する(行アンカーではなく範囲アンカーの扱い)。
function checkFences(doc, findings, lineRanges) {
  for (const fence of doc.fences) {
    if (fence.closeLine === null) {
      if (!rangeInScope(lineRanges, fence.openIdx, doc.lines.length - 1)) continue;
      findings.push({
        rule: "fence-unclosed-or-malformed",
        line: fence.openIdx + 1,
        message: "code fence の閉じが見つからない、または不整形(自動修正していない)",
      });
    }
  }
}

// glob パターン(**/foo)のような「意図的な **」を誤検出しないよう、内容が `/` で
// 始まる場合は候補から除外する。それでも判定を誤り得るため、あくまで検出のみ・
// 修正は Claude に委ねる(formatter では自動修正しない)。
// 成立済みの装飾 span・code span・保護領域は残余(residual)から除外してあるため、
// ここで拾うのは「装飾としてパースされずに地の文へ残る」記号だけになる。
const MARKER_PATTERNS = [
  { re: /\*\*([^\n*]+?)\*\*/g, rule: "possible-unrendered-bold" },
  { re: /~~([^\n~]+?)~~/g, rule: "possible-unrendered-strikethrough" },
];

// masked 内で見つかった候補を { rule, offset, match } の配列で返す(offset は masked 内)。
function markerMatches(masked) {
  return MARKER_PATTERNS.flatMap(({ re, rule }) =>
    [...masked.matchAll(re)]
      .filter((m) => !m[1].startsWith("/")) // glob っぽい `**/...` を除外
      .map((m) => ({ rule, offset: m.index, match: m[0] })),
  );
}

function markerFinding({ rule, match }, lineIdx) {
  return {
    rule,
    line: lineIdx + 1,
    message: `装飾記号が地の文に残っている可能性: ${JSON.stringify(match)}`,
  };
}

// table-row 行は GFM のインライン解析がセル単位で行われるのに合わせ、セルごとに
// mask してから regex を適用する(行全体を 1 本として mask すると、別セルの
// 装飾記号を跨いで `**…**` が誤マッチする)。
// text 行は段落単位で mask する(行をまたぐ code span の内側を地の文と誤認しないため)。
// regex は "\n" を跨がないため、候補は必ず 1 行に収まり、その行へ帰属させる。
function paragraphMarkerCandidates(doc) {
  return textParagraphs(doc).flatMap((paragraph) =>
    markerMatches(residualMask(paragraph.text, scanInline(paragraph.text))).map((found) => ({
      found,
      lineIdx: partAt(paragraph, found.offset).lineIdx,
    })),
  );
}

function tableMarkerCandidates(doc) {
  return doc.lines.flatMap((line, idx) => {
    if (line.kind !== "table-row") return [];
    const content = line.raw.slice(line.contentStart);
    return tableRowSegments(content).flatMap((seg) => {
      const segText = content.slice(seg.start, seg.end);
      return markerMatches(residualMask(segText, scanInline(segText))).map((found) => ({
        found,
        lineIdx: idx,
      }));
    });
  });
}

function checkUnrenderedMarkers(doc, findings, lineRanges) {
  [...paragraphMarkerCandidates(doc), ...tableMarkerCandidates(doc)]
    .filter(({ lineIdx }) => lineInScope(lineRanges, lineIdx))
    .sort((a, b) => a.lineIdx - b.lineIdx)
    .forEach(({ found, lineIdx }) => findings.push(markerFinding(found, lineIdx)));
}

// cell の「表示テキスト」の近似(remark の text/inlineCode value 連結に対応):
// link/image は表示テキストへ置換し、成立した装飾 span のデリミタだけを除去する。
// 装飾として成立しなかった literal な `*`/`~`/`_` はそのまま数える。
function cellPlainText(cell) {
  const replaced = cell.replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1");
  const { spans } = scanInline(replaced);
  const drop = new Array(replaced.length).fill(false);
  for (const span of spans) {
    for (let i = span.start; i < span.start + span.delim; i++) drop[i] = true;
    for (let i = span.end - span.delim; i < span.end; i++) drop[i] = true;
  }
  // drop の index は UTF-16 単位なので、code point 分割([...])は使わない
  let out = "";
  for (let i = 0; i < replaced.length; i++) {
    if (!drop[i]) out += replaced[i];
  }
  return out;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function checkTableCells(doc, findings, lineRanges) {
  doc.lines.forEach((line, idx) => {
    if (line.kind !== "table-row") return;
    if (!lineInScope(lineRanges, idx)) return;
    const cells = splitTableRow(line.raw.slice(line.contentStart));
    for (const cell of cells) {
      const text = cellPlainText(cell);
      const hasComplexChild = /!?\[[^\]]*\]\([^)]*\)/.test(cell);
      if (text.length > TABLE_CELL_MAX_CHARS || hasComplexChild) {
        findings.push({
          rule: "table-cell-too-complex",
          line: idx + 1,
          message: `table cell が長い/複雑(${text.length}文字): ${JSON.stringify(truncate(text, 20))}`,
        });
      }
    }
  });
}

function checkListDepth(doc, findings, lineRanges) {
  const reported = new Set();
  for (const push of doc.listPushes) {
    if (push.depth > LIST_MAX_DEPTH) {
      if (!lineInScope(lineRanges, push.line)) continue;
      const line = push.line + 1;
      if (!reported.has(line)) {
        reported.add(line);
        findings.push({
          rule: "list-too-deep",
          line,
          message: `list のネストが深い(${push.depth}階層)`,
        });
      }
    }
  }
}

// lineRanges(Set<number>、0-indexed 行インデックス)を渡すと、行アンカーの finding
// をその範囲内のみに限定する(未指定なら全行が対象。scope.mjs 参照)。
export function lintMarkdown(source, { lineRanges } = {}) {
  const doc = scanDocument(source);
  const findings = [];
  checkFences(doc, findings, lineRanges);
  checkUnrenderedMarkers(doc, findings, lineRanges);
  checkTableCells(doc, findings, lineRanges);
  checkListDepth(doc, findings, lineRanges);
  return findings;
}
