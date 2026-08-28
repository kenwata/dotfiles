// かな・漢字・半角英数字。rules/markdown.md の「kana, kanji, or alphanumeric」定義に
// 一致させる(全角約物・空白はここに含めない = スペース挿入の対象外)。
// ぁ-ゟ ひらがな、゠-ヿ カタカナ、㐀-䶿 CJK拡張A、
// 一-鿿 CJK統合漢字、豈-﫿 CJK互換漢字
// (グリフをそのまま範囲指定に使うとコピー時の異体字/コードポイントずれで範囲が
// 意図せず広がる事故が起きるため、\u エスケープで明示する)
const WORD_CHAR =
  /[0-9A-Za-zぁ-ゟ゠-ヿ㐀-䶿一-鿿豈-﫿]/;

export function isWordChar(ch) {
  return !!ch && WORD_CHAR.test(ch);
}

export function lineStartOffset(source, offset) {
  const idx = source.lastIndexOf("\n", offset - 1);
  return idx + 1;
}

export function nextLineStartOffset(source, offset) {
  const idx = source.indexOf("\n", offset);
  return idx === -1 ? source.length : idx + 1;
}

export function isBlankRange(source, start, end) {
  return /^[ \t]*$/.test(source.slice(start, end));
}

// {start, end, replacement} 形式の編集を昇順に一括適用する。end==start は純粋な挿入。
// 重なりは想定していないため(呼び出し側が構築時に排他区間のみ生成する)、重なりを
// 検知した場合は安全側に倒して後発の編集を捨てる。
export function applyEdits(source, edits) {
  if (edits.length === 0) return { text: source, changed: false };
  const sorted = [...edits].sort((a, b) => a.start - b.start || a.end - b.end);
  let result = "";
  let cursor = 0;
  let prev = null;
  for (const edit of sorted) {
    if (edit.start < cursor) continue;
    // 完全に同一の編集(例: 隣接 fence の「後に空行」と「前に空行」が同一位置に
    // 挿入を生む)は 1 回だけ適用する
    if (
      prev &&
      prev.start === edit.start &&
      prev.end === edit.end &&
      prev.replacement === edit.replacement
    ) {
      continue;
    }
    result += source.slice(cursor, edit.start) + edit.replacement;
    cursor = edit.end;
    prev = edit;
  }
  result += source.slice(cursor);
  return { text: result, changed: result !== source };
}
