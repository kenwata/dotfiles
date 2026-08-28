// 行単位・1 パスの Markdown ブロック走査器。フル CommonMark パーサではなく、
// formatter/linter が必要とする範囲だけを判別する:
//   - ファイル先頭の frontmatter(---/+++)
//   - fenced code block(backtick/tilde。blockquote・list 内のものも追跡)
//   - インデント式 code block(相対 indent >= 4)
//   - table(header + delimiter 行の組で開始)
//   - list のネスト深さ(marker 行の push のみ記録 = remark の list ノード単位に対応)
//   - blockquote 深さ(prefix を剥がしてから以降を判定する)
//
// 既知の簡略化(README.md に記載): CRLF 非対応(このリポジトリは LF のみ)、
// タブは 1 文字として数える、段落の lazy continuation は list を閉じる扱いにする。

const FRONTMATTER_MARKER = /^(---|\+\+\+)$/;
const LIST_MARKER = /^([ \t]*)([-*+]|\d{1,9}[.)])(?:([ \t]+)(.*))?$/;
const BACKTICK_FENCE_OPEN = /^(`{3,})([^`]*)$/;
const TILDE_FENCE_OPEN = /^(~{3,})(.*)$/;
const FENCE_CLOSE = /^([ \t]*)(`{3,}|~{3,})[ \t]*$/;
const TABLE_DELIMITER =
  /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

function leadingWhitespaceLength(text) {
  const m = text.match(/^[ \t]*/);
  return m[0].length;
}

// blockquote prefix(`> ` の繰り返し)を剥がし、深さと剥がした後のテキストを返す。
function stripBlockquote(raw) {
  const m = raw.match(/^(?: {0,3}> ?)+/);
  if (!m) return { bqDepth: 0, content: raw };
  const depth = (m[0].match(/>/g) ?? []).length;
  return { bqDepth: depth, content: raw.slice(m[0].length) };
}

// `\|` エスケープを考慮して table 行を cell に分割する(前後の空 cell は除去)。
export function splitTableRow(rowContent) {
  const cells = [];
  let current = "";
  for (let i = 0; i < rowContent.length; i++) {
    const ch = rowContent[i];
    if (ch === "\\" && rowContent[i + 1] === "|") {
      current += "|";
      i++;
    } else if (ch === "|") {
      cells.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current);
  if (cells.length && cells[0].trim() === "") cells.shift();
  if (cells.length && cells.at(-1).trim() === "") cells.pop();
  return cells.map((c) => c.trim());
}

// `\|` エスケープを考慮して table 行を cell の { start, end } 範囲(content 内オフセット、
// trim なし)に分割する。GFM のインライン解析はセル単位で行われるため、装飾スペース
// 挿入・lint の走査をセル境界(この関数が返す範囲)ごとに区切って、別セルの装飾記号と
// 誤って対応付けられる事故(例: 表の行全体を 1 本の文字列として emphasis を走査すると、
// 手前のセルの閉じられない開き `**` が後方セルの `**` と対になってしまう)を防ぐ。
export function tableRowSegments(rowContent) {
  const segments = [];
  let start = 0;
  for (let i = 0; i < rowContent.length; i++) {
    const ch = rowContent[i];
    if (ch === "\\" && rowContent[i + 1] === "|") {
      i++;
    } else if (ch === "|") {
      segments.push({ start, end: i });
      start = i + 1;
    }
  }
  segments.push({ start, end: rowContent.length });
  return segments;
}

export function scanDocument(source) {
  const rawLines = source.split("\n");
  const lineStarts = [];
  {
    let offset = 0;
    for (const raw of rawLines) {
      lineStarts.push(offset);
      offset += raw.length + 1;
    }
  }

  // contentStart: blockquote prefix を剥がした本文の raw 内開始位置
  const lines = rawLines.map((raw) => ({ raw, kind: "text", bqDepth: 0, contentStart: 0 }));
  const fences = [];
  const listPushes = []; // { line, depth } — push 時のみ(remark の list ノード相当)

  // --- frontmatter(ファイル先頭のみ、閉じが見つかる場合のみ有効) ---
  let start = 0;
  if (rawLines.length > 0 && FRONTMATTER_MARKER.test(rawLines[0])) {
    for (let j = 1; j < rawLines.length; j++) {
      if (rawLines[j] === rawLines[0]) {
        for (let k = 0; k <= j; k++) lines[k].kind = "frontmatter";
        start = j + 1;
        break;
      }
    }
  }

  let fence = null; // { marker, runLen, bqDepth, listContentIndent, openIdx, absIndent, atRoot, infoString }
  let listStack = []; // { markerIndent, contentIndent }
  let lastBqDepth = 0;
  let prevKind = "blank"; // 文書先頭は空行相当(インデント式 code の開始を許す)
  let tableActive = false;
  let pendingTableDelimiter = false;

  const closeFenceAsUnclosed = () => {
    fences.push({ ...fence, closeLine: null, closeRunLen: null, closeAbsIndent: null });
    fence = null;
  };

  const tryOpenFence = (rest, i, absIndent, bqDepth) => {
    const bt = rest.match(BACKTICK_FENCE_OPEN);
    const td = bt ? null : rest.match(TILDE_FENCE_OPEN);
    const m = bt ?? td;
    if (!m) return false;
    fence = {
      marker: m[1][0],
      runLen: m[1].length,
      bqDepth,
      listContentIndent: listStack.length ? listStack.at(-1).contentIndent : 0,
      openIdx: i,
      absIndent,
      atRoot: listStack.length === 0 && bqDepth === 0,
      infoString: m[2] ?? "",
    };
    lines[i].kind = "fence-open";
    return true;
  };

  for (let i = start; i < rawLines.length; i++) {
    const raw = rawLines[i];

    // --- fence 内 ---
    // fence の内容は literal であり、`> ` で始まる行も blockquote ではなく内容
    // (シェルプロンプトのコード例など)。blockquote prefix の解釈が要るのは
    // fence 自体が blockquote 内で開かれた場合だけで、その場合に prefix が
    // 消えた行は blockquote の終了 = fence の未閉中断として扱う。
    if (fence) {
      let fenceContent = raw;
      if (fence.bqDepth > 0) {
        const s = stripBlockquote(raw);
        lines[i].bqDepth = s.bqDepth;
        lines[i].contentStart = raw.length - s.content.length;
        if (s.bqDepth < fence.bqDepth) {
          closeFenceAsUnclosed();
        } else {
          fenceContent = s.content;
        }
      }
      if (fence) {
        const closeMatch =
          lines[i].bqDepth === fence.bqDepth ? fenceContent.match(FENCE_CLOSE) : null;
        if (
          closeMatch &&
          closeMatch[2][0] === fence.marker &&
          closeMatch[2].length >= fence.runLen &&
          closeMatch[1].length <= fence.listContentIndent + 3
        ) {
          lines[i].kind = "fence-close";
          fences.push({
            ...fence,
            closeLine: i,
            closeRunLen: closeMatch[2].length,
            closeAbsIndent: leadingWhitespaceLength(raw),
          });
          fence = null;
        } else {
          lines[i].kind = "fence-content";
        }
        prevKind = lines[i].kind;
        continue;
      }
    }

    const { bqDepth, content } = stripBlockquote(raw);
    lines[i].bqDepth = bqDepth;
    lines[i].contentStart = raw.length - content.length;

    // --- 通常処理 ---
    if (bqDepth !== lastBqDepth) {
      listStack = [];
      tableActive = false;
      pendingTableDelimiter = false;
    }
    lastBqDepth = bqDepth;

    if (/^[ \t]*$/.test(content)) {
      lines[i].kind = "blank";
      tableActive = false;
      pendingTableDelimiter = false;
      prevKind = "blank";
      continue;
    }

    if (pendingTableDelimiter) {
      lines[i].kind = "table-delimiter";
      pendingTableDelimiter = false;
      tableActive = true;
      prevKind = "table-delimiter";
      continue;
    }

    const leading = leadingWhitespaceLength(content);

    // list marker 行
    const listMatch = content.match(LIST_MARKER);
    if (listMatch) {
      const markerIndent = listMatch[1].length;
      const markerLen = listMatch[2].length;
      const spacesLen = listMatch[3]?.length ?? 1;
      // marker 後の空白 5 個以上は「1 個 + インデント式 code」の扱い(CommonMark)
      const contentIndent = markerIndent + markerLen + (spacesLen > 4 ? 1 : spacesLen);

      while (listStack.length && markerIndent < listStack.at(-1).markerIndent) {
        listStack.pop();
      }
      if (!listStack.length || markerIndent >= listStack.at(-1).contentIndent) {
        listStack.push({ markerIndent, contentIndent });
        listPushes.push({ line: i, depth: listStack.length });
      } else {
        // 同階層の次 item: contentIndent を更新するのみ(remark でも新 list ノードではない)
        listStack.at(-1).markerIndent = markerIndent;
        listStack.at(-1).contentIndent = contentIndent;
      }

      // item 先頭行で始まる fence(`- ```js` のような形)
      const rest = listMatch[4] ?? "";
      if (rest && tryOpenFence(rest, i, leadingWhitespaceLength(raw), bqDepth)) {
        prevKind = "fence-open";
        continue;
      }
      tableActive = false;
      prevKind = "text";
      continue;
    }

    // list コンテキストから外れた行で stack を縮める
    while (listStack.length && leading < listStack.at(-1).contentIndent) {
      listStack.pop();
    }
    const relative = leading - (listStack.length ? listStack.at(-1).contentIndent : 0);

    // インデント式 code(段落を interrupt できないため、直前が空行 or 継続のみ)
    if (relative >= 4 && (prevKind === "blank" || prevKind === "indented-code")) {
      lines[i].kind = "indented-code";
      tableActive = false;
      prevKind = "indented-code";
      continue;
    }

    // fence 開始
    if (relative <= 3 && tryOpenFence(content.slice(leading), i, leadingWhitespaceLength(raw), bqDepth)) {
      tableActive = false;
      prevKind = "fence-open";
      continue;
    }

    // table
    if (content.includes("|")) {
      if (tableActive) {
        lines[i].kind = "table-row";
        prevKind = "table-row";
        continue;
      }
      const next = i + 1 < rawLines.length ? stripBlockquote(rawLines[i + 1]) : null;
      if (
        next &&
        next.bqDepth === bqDepth &&
        next.content.includes("-") &&
        TABLE_DELIMITER.test(next.content) &&
        !/^[ \t]*$/.test(next.content) &&
        // GFM: delimiter 行の cell 数は header と一致する必要がある
        // (setext 見出しの `---` を delimiter と誤認しないための判定でもある)
        splitTableRow(next.content).length === splitTableRow(content).length
      ) {
        lines[i].kind = "table-row"; // header 行
        pendingTableDelimiter = true;
        prevKind = "table-row";
        continue;
      }
    } else if (tableActive) {
      tableActive = false;
    }

    lines[i].kind = "text";
    prevKind = "text";
  }

  if (fence) closeFenceAsUnclosed();

  return { lines, lineStarts, fences, listPushes };
}
