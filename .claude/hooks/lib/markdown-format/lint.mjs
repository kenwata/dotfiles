import { scanDocument, splitTableRow } from "./scan.mjs";
import { scanInline, residualMask } from "./inline.mjs";

const TABLE_CELL_MAX_CHARS = 40;
const LIST_MAX_DEPTH = 2;

// フォーマッタが 4 backticks 以上・開始終了一致まで直した後でも、閉じ fence 自体が
// 見つからない(欠落・不整形)ケースは意図の推定が要るため自動修正せず検出のみ行う。
function checkFences(doc, findings) {
  for (const fence of doc.fences) {
    if (fence.closeLine === null) {
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
function checkUnrenderedMarkers(doc, findings) {
  const MARKER_PATTERNS = [
    { re: /\*\*([^\n*]+?)\*\*/g, rule: "possible-unrendered-bold" },
    { re: /~~([^\n~]+?)~~/g, rule: "possible-unrendered-strikethrough" },
  ];

  doc.lines.forEach((line, idx) => {
    if (line.kind !== "text" && line.kind !== "table-row") return;
    const masked = residualMask(line.raw, scanInline(line.raw));
    for (const { re, rule } of MARKER_PATTERNS) {
      for (const m of masked.matchAll(re)) {
        if (m[1].startsWith("/")) continue; // glob っぽい `**/...` を除外
        findings.push({
          rule,
          line: idx + 1,
          message: `装飾記号が地の文に残っている可能性: ${JSON.stringify(m[0])}`,
        });
      }
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

function checkTableCells(doc, findings) {
  doc.lines.forEach((line, idx) => {
    if (line.kind !== "table-row") return;
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

function checkListDepth(doc, findings) {
  const reported = new Set();
  for (const push of doc.listPushes) {
    if (push.depth > LIST_MAX_DEPTH) {
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

export function lintMarkdown(source) {
  const doc = scanDocument(source);
  const findings = [];
  checkFences(doc, findings);
  checkUnrenderedMarkers(doc, findings);
  checkTableCells(doc, findings);
  checkListDepth(doc, findings);
  return findings;
}
