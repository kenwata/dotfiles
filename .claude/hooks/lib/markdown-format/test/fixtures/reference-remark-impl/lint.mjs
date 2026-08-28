import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import remarkFrontmatter from "remark-frontmatter";

const TABLE_CELL_MAX_CHARS = 40;
const LIST_MAX_DEPTH = 2;

function parseTree(source) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkMath)
    .use(remarkFrontmatter, ["yaml", "toml"])
    .parse(source);
}

function lineOf(source, offset) {
  let line = 1;
  for (let i = 0; i < offset; i++) {
    if (source[i] === "\n") line++;
  }
  return line;
}

// フォーマッタが 4 backticks 以上・開始終了一致まで直した後でも、閉じ fence 自体が
// 見つからない(欠落・不整形)ケースは意図の推定が要るため自動修正せず検出のみ行う。
function checkFences(source, tree, findings) {
  function walk(node) {
    if (node.type === "code") {
      const start = node.position?.start?.offset;
      const end = node.position?.end?.offset;
      if (typeof start === "number" && typeof end === "number") {
        const blockText = source.slice(start, end);
        const lines = blockText.split("\n");
        const openMatch = lines[0].match(/^[ \t]{0,3}`{3,}/);
        if (openMatch) {
          const closeMatch = lines[lines.length - 1].match(/^[ \t]{0,3}`{3,}[ \t]*$/);
          if (!closeMatch || lines.length < 2) {
            findings.push({
              rule: "fence-unclosed-or-malformed",
              line: lineOf(source, start),
              message: "code fence の閉じが見つからない、または不整形(自動修正していない)",
            });
          }
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
}

// glob パターン(**/foo)のような「意図的な **」を誤検出しないよう、内容が `/` で
// 始まる場合は候補から除外する。それでも判定を誤り得るため、あくまで検出のみ・
// 修正は Claude に委ねる(formatter では自動修正しない)。
function checkUnrenderedMarkers(source, tree, findings) {
  const MARKER_PATTERNS = [
    { marker: "**", re: /\*\*([^\n*]+?)\*\*/g, rule: "possible-unrendered-bold" },
    { marker: "~~", re: /~~([^\n~]+?)~~/g, rule: "possible-unrendered-strikethrough" },
  ];

  function walk(node) {
    if (node.type === "text" && typeof node.value === "string" && node.position) {
      const base = node.position.start.offset;
      for (const { re, rule } of MARKER_PATTERNS) {
        for (const m of node.value.matchAll(re)) {
          if (m[1].startsWith("/")) continue; // glob っぽい `**/...` を除外
          const offset = (typeof base === "number" ? base : 0) + m.index;
          findings.push({
            rule,
            line: typeof base === "number" ? lineOf(source, offset) : node.position.start.line,
            message: `装飾記号が地の文に残っている可能性: ${JSON.stringify(m[0])}`,
          });
        }
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
}

function checkTableCells(tree, findings) {
  function walk(node) {
    if (node.type === "tableCell") {
      const text = cellText(node);
      const hasComplexChild = node.children?.some(
        (c) => c.type === "link" || c.type === "image" || c.type === "break",
      );
      if (text.length > TABLE_CELL_MAX_CHARS || hasComplexChild) {
        findings.push({
          rule: "table-cell-too-complex",
          line: node.position?.start?.line ?? 0,
          message: `table cell が長い/複雑(${text.length}文字): ${JSON.stringify(truncate(text, 20))}`,
        });
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child);
    }
  }
  walk(tree);
}

function cellText(node) {
  let out = "";
  function walk(n) {
    if (typeof n.value === "string") out += n.value;
    if (Array.isArray(n.children)) for (const c of n.children) walk(c);
  }
  walk(node);
  return out;
}

function truncate(text, max) {
  return text.length > max ? text.slice(0, max) + "…" : text;
}

function checkListDepth(tree, findings) {
  const reported = new Set();
  function walk(node, depth) {
    const nextDepth = node.type === "list" ? depth + 1 : depth;
    if (node.type === "list" && nextDepth > LIST_MAX_DEPTH) {
      const line = node.position?.start?.line ?? 0;
      if (!reported.has(line)) {
        reported.add(line);
        findings.push({
          rule: "list-too-deep",
          line,
          message: `list のネストが深い(${nextDepth}階層)`,
        });
      }
    }
    if (Array.isArray(node.children)) {
      for (const child of node.children) walk(child, nextDepth);
    }
  }
  walk(tree, 0);
}

export function lintMarkdown(source) {
  const tree = parseTree(source);
  const findings = [];
  checkFences(source, tree, findings);
  checkUnrenderedMarkers(source, tree, findings);
  checkTableCells(tree, findings);
  checkListDepth(tree, findings);
  return findings;
}
