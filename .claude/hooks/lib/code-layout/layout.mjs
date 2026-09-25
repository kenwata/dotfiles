import { END_CLOSER } from "./languages.mjs";

// coding-principles.md §14(Layout)のうち、機械で決められる最低限の位置だけを検査する。
// どこで段落を切るかという意味の判断は検査しない(§9 の完了前点検に残す)。
// 入力は整形後のソースを想定し、構文木は作らない。インデントと数種類の記号だけで読むので、
// 言語ごとの差分は languages.mjs の表に閉じる。

// §14 の行幅の上限(桁)
export const MAX_COLUMNS = 100;

// §14 の「空行なしで続く文」の上限。これ以上続けば指摘する。初期値は SpacialOchestrationResearch と
// VC_Analysis の既存コードで指摘の数を測って決めた(hooks/lib/code-layout/README.md)
export const MAX_RUN_STATEMENTS = 8;

// 閉じの return の直前に、空行なしで続いてよい文の数。宣言 1 つとその使用は 1 段落(§14)
const RETURN_GLUE_LIMIT = 1;

// 折り返せない長いリテラル: 空白を含まない中身が 58 桁以上の文字列リテラル
// (引用符を含めて 60 桁以上)。ハッシュ・生成データ・長い識別子の列など。
// メソッドチェーンや引数の並びは折り返せるので含めない
const LONG_LITERAL = /(["'`])[^\s"'`]{58,}\1/;

const TAB_WIDTH = 4;
const URL = /\bhttps?:\/\//;
const QUOTE_ONLY_LINE = /^[`'"].*[`'"][,;)\]]*$/;
const BRACE_CLOSER = /^\}[)\];]*$/;
const CLOSING_ONLY = /^[)\]}]/;

// JSX のマークアップ(`<p>` `{expr}`)と、行頭に置いた開き括弧。どちらも手順の文ではない
const MARKUP_OR_BRACE = /^[<{]/;

// 開きの `{` の直前がこれならオブジェクト・配列などのリテラルで、ブロックではない
const LITERAL_OPENER = /(=|\(|,|:|\[|<|\breturn|\bdefault|\?\?|&&|\|\|)\s*\{$/;

// 前の行がこれで終われば、次の行は同じ文の続き(複数行の引数・式)
const CONTINUES_NEXT_LINE = /([([,=+\-*/%&|?\\]|=>)$/;
// `|` `&` は論理演算に加えて、TypeScript の union・intersection 型の続きの行
const LEADING_OPERATOR = /^(\.|\?\.|[|&]|\+|-(?!-)|\*|\/(?!\/)|\?|:)/;

// 開きの括弧と、対応する閉じ。`(` `[` の中の行は複数行の式の続きで、文ではない。
// `{` は brace / end の言語ではブロックかリテラルの開きなので、中の行を文として数える
// (コールバックの本体など)。インデントの言語(Python)の `{` は辞書・集合の括弧で、中に文は無い
const BRACKET_PAIRS = new Map([
  ["(", ")"],
  ["[", "]"],
  ["{", "}"],
]);

// 括弧を追う言語の blockStyle(markBracketContinuations)
const BRACKET_TRACKED_STYLES = ["brace", "indent"];

// 括弧を数える前に除く、1 行の中で閉じた文字列リテラル
const QUOTED_LITERAL = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;

// 行頭に並ぶ閉じの括弧(`)` `})` `]);` の先頭など)
const LEADING_CLOSERS = /^[)\]}]*/;

// メンバーの並び(型・クラスのフィールド、リテラルの要素)を囲む見出し。中の行は手順の文ではない
const CONTAINER_KEYWORDS = [
  "interface",
  "type",
  "enum",
  "class",
  "struct",
  "record",
  "trait",
  "object",
];
const MEMBER_CONTAINER = new RegExp(
  `^(export\\s+)?(default\\s+)?(abstract\\s+)?(declare\\s+)?(${CONTAINER_KEYWORDS.join("|")})\\b`,
);

const GUARD_HEADER = /^(\}\s*else\s+)?(if|unless|guard)\b/;
const JUMP = /^(return|throw|raise|continue|break|exit|next)\b/;

// シェルで 1 行に並べた本体の最後がジャンプ(`echo ...; return`)
const TRAILING_JUMP = /;\s*(return|exit|continue|break)\b[^;]*$/;


// 1 行で書いたガード節(`if (x) return y;` `if x: return y`)。連続すれば 1 段落(§14)
const SINGLE_LINE_GUARD = /^(if|unless|guard)\b.*\b(return|throw|raise|continue|break|next)\b/;

// East Asian Wide / Fullwidth の主な範囲。整形ツール(Prettier・ruff)と同じく 2 桁で数える
const WIDE_RANGES = [
  [0x1100, 0x115f],
  [0x2e80, 0xa4cf],
  [0xac00, 0xd7a3],
  [0xf900, 0xfaff],
  [0xfe30, 0xfe4f],
  [0xff00, 0xff60],
  [0xffe0, 0xffe6],
  [0x1f300, 0x1faff],
  [0x20000, 0x3fffd],
];

// 表示上の桁数を返す。全角文字は 2 桁、タブは TAB_WIDTH 桁
export function displayWidth(text) {
  let width = 0;

  for (const char of text) {
    const code = char.codePointAt(0);

    if (char === "\t") width += TAB_WIDTH;
    else if (WIDE_RANGES.some(([low, high]) => code >= low && code <= high)) width += 2;
    else width += 1;
  }

  return width;
}

// ソースを検査し、指摘の配列を返す。行番号は 1 始まり。
// 指摘: { kind, startLine, endLine, message }。
// kind は width / glued-block / glued-return / long-run
export function findLayoutIssues(source, language) {
  const lines = classifyLines(source, language);

  const issues = [
    ...findWidthIssues(lines),
    ...findGluedBlocks(lines, language),
    ...findGluedReturns(lines, language),
    ...findLongRuns(lines, language),
  ];

  return dropCoveredReturns(issues).sort((a, b) => a.startLine - b.startLine);
}

// 各行に種類(blank / comment / string / code)とインデントを付ける。
// ブロックコメントと複数行の文字列の中は、閉じの記号や文として読まないよう code から外す
function classifyLines(source, language) {
  const { comments, multilineStrings } = language;
  let blockEnd = null;
  let stringDelimiter = null;
  let heredocEnd = null;

  return source.split("\n").map((text) => {
    const trimmed = text.trim();
    const indent = displayWidth(text.slice(0, text.length - text.trimStart().length));
    const line = { text, trimmed, indent, kind: "code" };

    if (heredocEnd !== null) {
      if (trimmed === heredocEnd) heredocEnd = null;
      return { ...line, kind: "string" };
    }

    if (blockEnd !== null) {
      if (trimmed.includes(blockEnd)) blockEnd = null;
      return { ...line, kind: "comment" };
    }

    if (stringDelimiter !== null) {
      const delimiter = stringDelimiter;

      if (countOccurrences(text, delimiter) % 2 === 0) return { ...line, kind: "string" };

      // 文字列を閉じた行の残り(`` `).then(() => { `` の `).then(() => {`)。括弧の追跡が読む
      const afterString = text.slice(text.lastIndexOf(delimiter) + delimiter.length).trim();

      stringDelimiter = null;
      return { ...line, kind: "string", afterString };
    }

    if (trimmed === "") return { ...line, kind: "blank" };
    if (comments.line.some((marker) => trimmed.startsWith(marker))) {
      return { ...line, kind: "comment" };
    }

    const block = comments.block.find(([start]) => trimmed.startsWith(start));

    if (block !== undefined) {
      if (!trimmed.slice(block[0].length).includes(block[1])) blockEnd = block[1];
      return { ...line, kind: "comment" };
    }

    const heredoc = language.heredoc === null ? null : language.heredoc.exec(trimmed);

    if (heredoc !== null) heredocEnd = heredoc.groups.tag;

    const opensString = (d) => countOccurrences(withoutQuoted(text, d), d) % 2 === 1;
    const delimiter = multilineStrings.find(opensString);

    if (delimiter !== undefined) stringDelimiter = delimiter;

    const startsInString = multilineStrings.some((d) => trimmed.startsWith(d));

    return { ...line, kind: startsInString ? "string" : "code" };
  });
}

// バッククォートを数える前に、通常の文字列リテラル("..." '...')の中身を除く。
// `"```"` のようなフェンスを組み立てる行を、テンプレートリテラルの開始と読み違えないため
function withoutQuoted(text, delimiter) {
  if (delimiter !== "`") return text;

  return text.replace(/"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g, "");
}

function countOccurrences(text, needle) {
  return text.split(needle).length - 1;
}

function findWidthIssues(lines) {
  return lines.flatMap((line, index) => {
    if (displayWidth(line.text) <= MAX_COLUMNS || isUnbreakable(line.trimmed)) return [];

    const width = displayWidth(line.text);
    const message = `line is ${width} columns (max ${MAX_COLUMNS}); let the formatter wrap it`;

    return [issue("width", index, index, message)];
  });
}

function isUnbreakable(trimmed) {
  if (URL.test(trimmed) || QUOTE_ONLY_LINE.test(trimmed)) return true;

  return LONG_LITERAL.test(trimmed);
}

// 閉じたブロックの直後に、空行なしで同じ深さの次の文が続く箇所
function findGluedBlocks(lines, language) {
  if (language.blockStyle === "none") return [];

  return lines.flatMap((line, index) => {
    const next = lines[index + 1];

    if (next === undefined || next.kind === "blank" || line.kind !== "code") return [];
    if (language.continuation.test(next.trimmed)) return [];

    const closed = language.blockStyle === "indent"
      ? closedIndentBlock(lines, index)
      : closedBraceBlock(lines, index, language);

    if (closed === null || isGuardChain(lines, closed, next)) return [];

    const message =
      `statement glued to the block closed on L${index + 1}; add a blank line where the step changes`;

    return [issue("glued-block", index, index + 1, message)];
  });
}

// brace / end の言語で、line が閉じたブロックの { opener, closer } を返す。閉じでなければ null
function closedBraceBlock(lines, index, language) {
  const line = lines[index];
  const next = lines[index + 1];
  const isEnd = language.blockStyle === "end" && END_CLOSER.test(line.trimmed);

  if (!isEnd && !BRACE_CLOSER.test(line.trimmed)) return null;
  if (next.indent !== line.indent) return null;

  const openerIndex = findOpener(lines, index, line.indent);

  if (openerIndex === null) return null;
  if (!isEnd && !isBlockOpener(lines[openerIndex].trimmed)) return null;

  return { opener: openerIndex, closer: index };
}

function isBlockOpener(trimmed) {
  return trimmed.endsWith("{") && !LITERAL_OPENER.test(trimmed);
}

// インデントの言語で、line がブロックの最後の行なら { opener, closer } を返す。
// 次の行のインデントが戻り、戻った深さの直前の行が `:` で終わる見出しなら、ブロックが閉じている
function closedIndentBlock(lines, index) {
  const line = lines[index];
  const next = lines[index + 1];

  if (next.indent >= line.indent) return null;

  const openerIndex = findOpener(lines, index + 1, next.indent);

  if (openerIndex === null || !lines[openerIndex].trimmed.endsWith(":")) return null;

  return { opener: openerIndex, closer: index + 1 };
}

// index より前で、同じインデントの code の行を探す(ブロックの開き、または見出し)
function findOpener(lines, index, indent) {
  for (let i = index - 1; i >= 0; i--) {
    const candidate = lines[i];

    if (candidate.kind !== "code") continue;
    if (candidate.indent === indent) return i;
    if (candidate.indent < indent) return null;
  }

  return null;
}

// 本体が 1 文のジャンプだけのガード節が、次のガード節へ続く場合は 1 段落(§14)
function isGuardChain(lines, closed, next) {
  const header = lines[headerOf(lines, closed.opener)];
  const body = lines.slice(closed.opener + 1, closed.closer).filter((l) => l.kind === "code");

  return GUARD_HEADER.test(header.trimmed) && isSingleJump(body) && GUARD_HEADER.test(next.trimmed);
}

// 条件が複数行にわたる見出し(`) {` で開く)なら、同じ深さをさかのぼって `if` の行を返す
function headerOf(lines, openerIndex) {
  const { indent } = lines[openerIndex];
  let index = openerIndex;

  while (index > 0 && CLOSING_ONLY.test(lines[index].trimmed)) {
    const previous = findOpener(lines, index, indent);

    if (previous === null) break;
    index = previous;
  }

  return index;
}

// 本体がジャンプ 1 文だけか。複数行に折り返したジャンプ(`throw new X(` 〜 `);`)も 1 文とみなす
function isSingleJump(body) {
  if (body.length === 0) return false;
  if (body.length === 1 && TRAILING_JUMP.test(body[0].trimmed)) return true;
  if (!JUMP.test(body[0].trimmed)) return false;

  const { indent } = body[0];

  return body.slice(1).every((l) => l.indent > indent || CLOSING_ONLY.test(l.trimmed));
}

// 2 文以上の直後に、空行なしで続く閉じの return
function findGluedReturns(lines, language) {
  if (language.returnPattern === null) return [];

  return lines.flatMap((line, index) => {
    if (line.kind !== "code" || !language.returnPattern.test(line.trimmed)) return [];

    const first = firstGluedStatement(lines, index);
    const count = countStatementsAt(lines, first, index, line.indent);

    if (count <= RETURN_GLUE_LIMIT) return [];

    const message = `closing return glued to ${count} statements; separate it with a blank line`;

    return [issue("glued-return", first, index, message)];
  });
}

// index の行から空行なしでさかのぼれる、同じ深さ以上の行の先頭
function firstGluedStatement(lines, index) {
  const indent = lines[index].indent;
  let first = index;

  while (first > 0 && lines[first - 1].kind !== "blank" && lines[first - 1].indent >= indent) {
    first--;
  }

  return first;
}

function countStatementsAt(lines, from, to, indent) {
  return lines
    .slice(from, to)
    .filter((l) => l.kind === "code" && l.indent === indent)
    .filter((l) => !CLOSING_ONLY.test(l.trimmed) && !SINGLE_LINE_GUARD.test(l.trimmed)).length;
}

// 空行なしで MAX_RUN_STATEMENTS 文以上続く箇所
function findLongRuns(lines, language) {
  const marked = markBracketContinuations(lines, language);

  return splitRuns(marked).flatMap(({ start, end }) => {
    const count = countRunStatements(marked, start, end, language);

    if (count < MAX_RUN_STATEMENTS) return [];

    const message = `${count} statements without a blank line; break where the step really changes`;

    return [issue("long-run", start, end, message)];
  });
}

// code の各行に continued(開いたまま閉じていない括弧の中の行か)を付ける。`and` `or` で始まる
// Python の条件の続きや、括弧の中で連結する文字列の行は、前の行の記号だけでは続きと分からないため。
// 整形後のコードでは、括弧の中身は開いた行より深く、閉じの行は開いた行の深さ以下に戻る。そこで、
// 行頭の閉じを処理した後に、その行より浅い行で開いた括弧だけを囲みとみなす。行を読み終えた後は、
// 前の行でその行と同じ深さ以上で開き、まだ閉じていない括弧を捨てる。正規表現リテラルなどの括弧で
// 対応が崩れても、開いた行の深さに戻った所で読み直せる。複数行の文字列を閉じた行は、閉じの後ろ
// (`` `); `` の `);`)だけを読む。`end` の言語(シェル・Ruby・Lua)は括弧の中に
// `function() ... end` の本体(文の並び)を置けるので、括弧を追わない
function markBracketContinuations(lines, language) {
  if (!BRACKET_TRACKED_STYLES.includes(language.blockStyle)) return lines;

  let open = [];

  return lines.map((line, index) => {
    const code = line.kind === "code" ? line.trimmed : line.afterString;

    if (code === undefined) return line;

    const read = readBrackets(code, open, { indent: line.indent, line: index }, language);

    open = read.open;

    return line.kind === "code" ? { ...line, continued: read.continued } : line;
  });
}

// 1 行(code)の括弧を読み、{ continued, open } を返す。continued はその行が囲みの括弧の中か、
// open は次の行へ渡す開きの並び。opener はその行の深さ indent と行番号 line
function readBrackets(code, open, opener, language) {
  const text = bracketText(code, language);
  const [leading] = LEADING_CLOSERS.exec(text);
  const afterLeading = closeLeading(leading, open, opener.indent);
  const innermost = afterLeading.filter((bracket) => bracket.indent < opener.indent).at(-1);
  const continued =
    innermost !== undefined && (language.blockStyle === "indent" || innermost.char !== "{");

  const scanned = scanBrackets(text.slice(leading.length), afterLeading, opener);
  const settled = settleBlockHeader(scanned, code, opener, language);

  const carried = settled.filter(
    (bracket) => bracket.line === opener.line || bracket.indent < opener.indent,
  );

  return { continued, open: carried };
}

// 文字列リテラルと行末のコメントを除いた、括弧を数える部分
function bracketText(trimmed, language) {
  const code = trimmed.replace(QUOTED_LITERAL, "");
  const cuts = language.comments.line.map((marker) => code.indexOf(marker)).filter((i) => i >= 0);

  return cuts.length === 0 ? code : code.slice(0, Math.min(...cuts));
}

// 行頭の閉じで開きを外す。外せるのは、まずその行の深さ以上で開いた直近の開き。Prettier が
// `as Array<{` の中身を開いた行と同じ深さに置き、閉じ `}>;` を浅い行に置くと、`{` は中身の行で
// 捨て済みで、行頭の `}` が外側のブロックの `{` を外してしまうため。`)` `]` は、それが無ければ
// 浅い行の開きも外す(手書きで本体と同じ深さに置いた条件の閉じ `) {`)
function closeLeading(leading, open, indent) {
  return [...leading].reduce((stack, char) => {
    const closed = closeBracket(stack, char, indent);

    return closed !== stack || char === "}" ? closed : closeBracket(stack, char, 0);
  }, open);
}

// text の括弧を open(開いたままの括弧の並び。下ほど浅い行で開いた)に積み、閉じで開きを外した並びを
// 返す。開きは opener を記録する。行の途中の閉じ(`|| b) {`)は、開いた行の深さを問わない
function scanBrackets(text, open, opener) {
  return [...text].reduce((stack, char) => {
    if (BRACKET_PAIRS.has(char)) return [...stack, { char, ...opener }];

    return closeBracket(stack, char, 0);
  }, open);
}

// closableFrom 以上の深さで開いた直近の同じ種類の開きを、間に残った開き(対応が崩れたもの)ごと外す。
// 外せる開きが無い(閉じでない文字を含む)時は、stack をそのまま返す
function closeBracket(stack, char, closableFrom) {
  const match = stack.findLastIndex(
    (bracket) => BRACKET_PAIRS.get(bracket.char) === char && bracket.indent >= closableFrom,
  );

  return match === -1 ? stack : stack.slice(0, match);
}

// ブロックの見出しの行(brace の言語で `{` で終わる行、Python で `:` で終わる行)の後には本体の文が
// 続く。正規表現の `//` をコメントと読んで行末の `{` を切り落とした時などに、見出しの行で開いたまま
// 残った括弧を捨て、brace の言語ではブロックの `{` を積む
function settleBlockHeader(stack, code, opener, language) {
  const isIndent = language.blockStyle === "indent";

  if (!code.endsWith(isIndent ? ":" : "{")) return stack;

  const top = stack.at(-1);

  if (!isIndent && top?.char === "{" && top.line === opener.line) return stack;

  const kept = stack.filter((bracket) => bracket.line !== opener.line);

  return isIndent ? kept : [...kept, { char: "{", ...opener }];
}

function splitRuns(lines) {
  const runs = [];
  let start = null;

  lines.forEach((line, index) => {
    if (line.kind === "blank") {
      if (start !== null) runs.push({ start, end: index - 1 });
      start = null;
    } else if (start === null) {
      start = index;
    }
  });

  if (start !== null) runs.push({ start, end: lines.length - 1 });

  return runs;
}

function countRunStatements(lines, start, end, language) {
  let count = 0;
  let previous = null;
  let previousWasGuard = false;

  for (let i = start; i <= end; i++) {
    const line = lines[i];

    if (line.kind !== "code") continue;

    const isGuard = SINGLE_LINE_GUARD.test(line.trimmed);

    const counts =
      !line.continued && isStatement(line, previous, language) && !isMember(lines, i, language);

    if (counts && !(isGuard && previousWasGuard)) count++;

    previous = line;
    previousWasGuard = isGuard;
  }

  return count;
}

// 数える文: code の行から、import・閉じだけの行・マークアップ・見出し・要素の行(`,` で終わる)・
// 前の行の続きを除いたもの
function isStatement(line, previous, language) {
  const { trimmed } = line;

  if (language.importPattern.test(trimmed) || CLOSING_ONLY.test(trimmed)) return false;
  if (MARKUP_OR_BRACE.test(trimmed)) return false;
  if (language.blockStyle === "end" && END_CLOSER.test(trimmed)) return false;
  if (trimmed.endsWith("{") || trimmed.endsWith(",")) return false;
  if (LEADING_OPERATOR.test(trimmed)) return false;
  if (language.blockStyle === "indent" && trimmed.endsWith(":")) return false;

  return previous === null || !CONTINUES_NEXT_LINE.test(previous.trimmed);
}

// 囲んでいるブロックが型・クラス・リテラルなら、その行はメンバーの宣言
function isMember(lines, index, language) {
  const container = enclosingHeader(lines, index);

  if (container === null) return false;
  if (language.blockStyle === "indent") return /^class\b/.test(container.trimmed);

  const { trimmed } = container;
  const isContainer = MEMBER_CONTAINER.test(trimmed) || LITERAL_OPENER.test(trimmed);

  return trimmed.endsWith("{") && isContainer;
}

// index の行より浅いインデントで直前にある code の行(囲んでいるブロックの見出し)
function enclosingHeader(lines, index) {
  const { indent } = lines[index];

  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].kind === "code" && lines[i].indent < indent) return lines[i];
  }

  return null;
}

// 閉じたブロックの直後の return は、glued-block の指摘に含まれるので重ねて出さない
function dropCoveredReturns(issues) {
  const blockEnds = new Set(issues.filter((i) => i.kind === "glued-block").map((i) => i.endLine));

  return issues.filter((i) => i.kind !== "glued-return" || !blockEnds.has(i.endLine));
}

function issue(kind, startIndex, endIndex, message) {
  return { kind, startLine: startIndex + 1, endLine: endIndex + 1, message };
}
