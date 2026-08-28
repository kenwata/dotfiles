// micromatch.isMatch(relPath, patterns, { dot: true }) の最小代替。
// rules/markdown.md の paths: で現実に使う範囲だけを対応する:
//   **/ (0個以上のディレクトリ)、** (任意)、* (セグメント内任意)、
//   ? (セグメント内1文字)、{a,b} (単純なブレース展開)
// dot: true 相当(先頭 . を特別扱いしない)はこの変換で自然に満たされる。

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/;

function expandBraces(pattern) {
  const m = pattern.match(/^(.*?)\{([^{}]*)\}(.*)$/);
  if (!m) return [pattern];
  const [, pre, body, post] = m;
  return body.split(",").flatMap((alt) => expandBraces(pre + alt + post));
}

function toRegExp(pattern) {
  let re = "";
  let i = 0;
  while (i < pattern.length) {
    if (
      pattern.startsWith("**/", i) &&
      (i === 0 || pattern[i - 1] === "/")
    ) {
      re += "(?:[^/]+/)*";
      i += 3;
    } else if (pattern.startsWith("**", i)) {
      re += ".*";
      i += 2;
    } else if (pattern[i] === "*") {
      re += "[^/]*";
      i += 1;
    } else if (pattern[i] === "?") {
      re += "[^/]";
      i += 1;
    } else {
      re += REGEX_SPECIAL.test(pattern[i]) ? "\\" + pattern[i] : pattern[i];
      i += 1;
    }
  }
  return new RegExp(`^${re}$`);
}

export function globMatch(relPath, patterns) {
  const normalized = relPath.replaceAll("\\", "/");
  return patterns
    .flatMap(expandBraces)
    .some((p) => toRegExp(p).test(normalized));
}
