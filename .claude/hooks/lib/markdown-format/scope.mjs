// PostToolUse hook 経由の Edit(部分編集ツール)では、保存されたファイル全体ではなく
// 「今回編集した行」だけに整形・lint を限定するためのスコープ計算。未編集の既存箇所
// (過去に書いた逐語引用等)への意図しない書き換えを構造的に防ぐ。Write は全文を書き直す
// ツールのため対象にせず、呼び出し側(cli.mjs)で従来どおり全体モードのままにする。

// newString(Edit の置換後テキスト)が保存後の source 内に出現する行を、0-indexed の
// 行インデックス集合として返す。複数出現があれば全て対象にする(indexOf ループ、
// 非重複)。newString が空、または出現が見つからない場合は空集合を返す
// (呼び出し側はこれを「対象なし」として扱い、フェイルオープンで何もしない)。
export function editedLineRanges(source, newString) {
  const ranges = new Set();
  if (!newString) return ranges;

  const lineStarts = [0];
  for (let i = 0; i < source.length; i++) {
    if (source[i] === "\n") lineStarts.push(i + 1);
  }
  const lineIndexOf = (offset) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  let searchFrom = 0;
  while (searchFrom <= source.length) {
    const idx = source.indexOf(newString, searchFrom);
    if (idx === -1) break;
    const startLine = lineIndexOf(idx);
    const endLine = lineIndexOf(idx + newString.length - 1);
    for (let l = startLine; l <= endLine; l++) ranges.add(l);
    searchFrom = idx + newString.length;
  }
  return ranges;
}

// lineRanges が未指定(全体モード)なら常に true。指定時は行インデックス idx が
// 対象範囲に含まれるかを返す。
export function lineInScope(lineRanges, idx) {
  return !lineRanges || lineRanges.has(idx);
}

// lineRanges が未指定なら常に true。指定時は [start, end](両端含む、0-indexed 行
// インデックス)が範囲と 1 行でも交差するかを返す。
export function rangeInScope(lineRanges, start, end) {
  if (!lineRanges) return true;
  for (let l = start; l <= end; l++) {
    if (lineRanges.has(l)) return true;
  }
  return false;
}

// formatMarkdown が空行を挿入すると、それより後ろの行の行インデックスが
// ずれるため、整形前(source)基準で作った lineRanges をそのまま整形後の
// テキストへ渡すと、その後段の lintMarkdown の検出が脱落・誤帰属する
// (2026-08-28、diff-reviewer の指摘で発見)。insertionBoundaries は「この
// 行の直前に 1 行挿入された」という整形前基準の行インデックス集合(重複が
// あっても実際の挿入は 1 回に潰れるため Set で渡す)。各行 l について、
// l 以下の boundary の個数だけ後ろへずらす。
export function translateLineRanges(lineRanges, insertionBoundaries) {
  if (!lineRanges || insertionBoundaries.size === 0) return lineRanges;
  const sorted = [...insertionBoundaries].sort((a, b) => a - b);
  const translated = new Set();
  for (const line of lineRanges) {
    let shift = 0;
    for (const b of sorted) {
      if (b <= line) shift++;
    }
    translated.add(line + shift);
  }
  return translated;
}
