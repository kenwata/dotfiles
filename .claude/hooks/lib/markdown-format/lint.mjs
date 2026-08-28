import { scanDocument, splitTableRow, tableRowSegments } from "./scan.mjs";
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

function pushMarkerFindings(findings, masked, line) {
  for (const { re, rule } of MARKER_PATTERNS) {
    for (const m of masked.matchAll(re)) {
      if (m[1].startsWith("/")) continue; // glob っぽい `**/...` を除外
      findings.push({
        rule,
        line,
        message: `装飾記号が地の文に残っている可能性: ${JSON.stringify(m[0])}`,
      });
    }
  }
}

// table-row 行は GFM のインライン解析がセル単位で行われるのに合わせ、セルごとに
// mask してから regex を適用する(行全体を 1 本として mask すると、別セルの
// 装飾記号を跨いで `**…**` が誤マッチする)。
function checkUnrenderedMarkers(doc, findings, lineRanges) {
  doc.lines.forEach((line, idx) => {
    if (line.kind !== "text" && line.kind !== "table-row") return;
    if (!lineInScope(lineRanges, idx)) return;
    if (line.kind === "table-row") {
      const content = line.raw.slice(line.contentStart);
      for (const seg of tableRowSegments(content)) {
        const segText = content.slice(seg.start, seg.end);
        const masked = residualMask(segText, scanInline(segText));
        pushMarkerFindings(findings, masked, idx + 1);
      }
    } else {
      const masked = residualMask(line.raw, scanInline(line.raw));
      pushMarkerFindings(findings, masked, idx + 1);
    }
  });
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
