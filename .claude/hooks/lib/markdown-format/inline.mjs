// 1 行分のインライン構文走査器。remark AST の代替として、装飾スペース挿入と
// lint(地の文に残った装飾記号の検出)に必要な span 境界だけを求める。
//
// 処理順(先に確定した領域は後段の走査から除外する):
//   1. backslash エスケープの解決
//   2. code span(N 連 backtick は次の「ちょうど N 連」で閉じる — CommonMark 6.1)
//   3. 保護領域: `](…)`(link/image の destination)と `<…>`(autolink/HTML タグ)。
//      完全な link パースはしない近似で、「触らない」方向にのみ倒す
//   4. inline math($ 対。開き直後・閉じ直前が非空白、閉じ直後が数字でない)
//   5. emphasis/strong/delete(*/_/~ の run に CommonMark 0.31 の flanking 判定)
//
// 対応付けは「同じ文字・同じ run 長の開き run と閉じ run を最近接で組にする」簡易版。
// remark のデリミタスタック(rule of 3 等)は再現しないが、組にならなかった run は
// 触らない(安全側)ため、誤挿入ではなく取りこぼしにしかならない。

const uniWs = (ch) => !ch || /[\s\p{Zs}]/u.test(ch);
const uniPunct = (ch) => !!ch && /[\p{P}\p{S}]/u.test(ch);

function computeEscaped(line) {
  const escaped = new Array(line.length).fill(false);
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\" && !escaped[i] && i + 1 < line.length) {
      escaped[i + 1] = true;
    }
  }
  return escaped;
}

// target 文字の連続 run を列挙する(エスケープ済み・確定済み位置は run を分断する)
function collectRuns(line, target, escaped, taken) {
  const runs = [];
  let start = -1;
  for (let i = 0; i <= line.length; i++) {
    const isRun =
      i < line.length && line[i] === target && !escaped[i] && !taken[i];
    if (isRun && start === -1) start = i;
    if (!isRun && start !== -1) {
      runs.push({ start, len: i - start });
      start = -1;
    }
  }
  return runs;
}

function markTaken(taken, start, end) {
  for (let i = start; i < end; i++) taken[i] = true;
}

// spans: { start, end(exclusive), type: 'code' | 'math' | 'emphasis' }
export function scanInline(line) {
  const escaped = computeEscaped(line);
  const taken = new Array(line.length).fill(false);
  const spans = [];
  const protectedRanges = [];

  // --- code span ---
  {
    const runs = collectRuns(line, "`", escaped, taken);
    let i = 0;
    while (i < runs.length) {
      const open = runs[i];
      let j = i + 1;
      while (j < runs.length && runs[j].len !== open.len) j++;
      if (j < runs.length) {
        const span = {
          start: open.start,
          end: runs[j].start + runs[j].len,
          type: "code",
          delim: open.len,
        };
        spans.push(span);
        markTaken(taken, span.start, span.end);
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  // --- 保護領域(装飾扱いせず、スペース挿入も lint もしない) ---
  for (const re of [/\]\([^)]*\)/g, /<[^>]*>/g]) {
    for (const m of line.matchAll(re)) {
      const start = m.index;
      const end = m.index + m[0].length;
      let overlap = false;
      for (let k = start; k < end; k++) if (taken[k]) overlap = true;
      if (overlap) continue;
      protectedRanges.push({ start, end });
      markTaken(taken, start, end);
    }
  }

  // --- inline math ---
  {
    const runs = collectRuns(line, "$", escaped, taken).filter((r) => r.len <= 2);
    const canOpen = (r) => !uniWs(line[r.start + r.len]);
    const canClose = (r) =>
      !uniWs(line[r.start - 1]) && !/[0-9]/.test(line[r.start + r.len] ?? "");
    let i = 0;
    while (i < runs.length) {
      const open = runs[i];
      if (!canOpen(open)) {
        i++;
        continue;
      }
      let j = i + 1;
      while (j < runs.length && !(runs[j].len === open.len && canClose(runs[j]))) j++;
      if (j < runs.length) {
        const span = {
          start: open.start,
          end: runs[j].start + runs[j].len,
          type: "math",
          delim: open.len,
        };
        spans.push(span);
        markTaken(taken, span.start, span.end);
        i = j + 1;
      } else {
        i++;
      }
    }
  }

  // --- emphasis / strong / delete ---
  {
    const delims = [];
    for (const ch of ["*", "_", "~"]) {
      for (const run of collectRuns(line, ch, escaped, taken)) {
        if (ch === "~" && run.len > 2) continue; // GFM strikethrough は 1〜2 連のみ
        const before = run.start > 0 ? line[run.start - 1] : "";
        const after = line[run.start + run.len] ?? "";
        const leftFlanking =
          !uniWs(after) && (!uniPunct(after) || uniWs(before) || uniPunct(before));
        const rightFlanking =
          !uniWs(before) && (!uniPunct(before) || uniWs(after) || uniPunct(after));
        let canOpen;
        let canClose;
        if (ch === "_") {
          // CommonMark: `_` は intraword で無効(snake_case を壊さないための要)
          canOpen = leftFlanking && (!rightFlanking || uniPunct(before));
          canClose = rightFlanking && (!leftFlanking || uniPunct(after));
        } else {
          canOpen = leftFlanking;
          canClose = rightFlanking;
        }
        if (canOpen || canClose) delims.push({ ...run, ch, canOpen, canClose });
      }
    }
    delims.sort((a, b) => a.start - b.start);

    const stack = [];
    for (const run of delims) {
      if (run.canClose) {
        let k = stack.length - 1;
        while (k >= 0 && !(stack[k].ch === run.ch && stack[k].len === run.len)) k--;
        if (k >= 0) {
          const opener = stack[k];
          stack.length = k; // 対になった opener と、その上に積まれた未対 opener を破棄
          spans.push({
            start: opener.start,
            end: run.start + run.len,
            type: "emphasis",
            delim: run.len,
          });
          continue;
        }
      }
      if (run.canOpen) stack.push(run);
    }
  }

  spans.sort((a, b) => a.start - b.start);
  return { spans, protectedRanges };
}

// spans・保護領域の内側を "\n" で塗りつぶした行を返す。lint の
// 「地の文に残った装飾記号」regex はこの結果に対して適用する
// ("\n" は regex の [^\n*] 等にマッチしないため、確定済み構文を跨いだ誤検出を防ぐ)。
export function residualMask(line, { spans, protectedRanges }) {
  // span の index は UTF-16 単位。[...line] は code point 分割で絵文字等が
  // あるとずれるため、必ず UTF-16 単位で分割する。
  const chars = line.split("");
  for (const list of [spans, protectedRanges]) {
    for (const r of list) {
      for (let i = r.start; i < r.end; i++) chars[i] = "\n";
    }
  }
  return chars.join("");
}
