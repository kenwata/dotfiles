import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { globMatch } from "./glob.mjs";

// rules/markdown.md の frontmatter は `paths:` の YAML リストのみを持つ薄い形式なので、
// YAML パーサを持ち込まず正規表現で抜く。
function parsePathsFrontmatter(content) {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return null;
  const body = fmMatch[1];
  const pathsMatch = body.match(/^paths:[ \t]*\n((?:[ \t]*-[ \t]*.+\n?)+)/m);
  if (!pathsMatch) return null;
  const items = [];
  for (const line of pathsMatch[1].split("\n")) {
    const m = line.match(/^[ \t]*-[ \t]*"?([^"]+?)"?[ \t]*$/);
    if (m) items.push(m[1]);
  }
  return items;
}

function ruleMatches(rulePath, relTarget) {
  if (!existsSync(rulePath)) return false;
  let content;
  try {
    content = readFileSync(rulePath, "utf8");
  } catch {
    return false;
  }
  const patterns = parsePathsFrontmatter(content);
  if (!patterns || patterns.length === 0) return false;
  return globMatch(relTarget, patterns);
}

// 対象ファイルに `<ruleDirs[i]>/rules/markdown.md`(プロジェクト優先、次に
// ユーザーレベル)がロードされる条件と同じ条件でのみ formatter を動かす。rules を
// 配布していないプロジェクトでは既存の diff 規約に影響を与えないため、常に false を
// 返す。
// ruleDirs の既定は Claude Code 本来の `.claude` のみ。Codex アダプター
// (.codex/hooks/format-markdown.mjs)は自身の呼び出しでのみ `--rules-dir=.codex` を
// 明示指定し、Claude Code から呼ばれた場合の判定基準は変えない(.codex/rules/*.md を
// 自動ロードする概念は Claude Code 側には無い)。
// userHome はテストでの注入用(既定は実ホームディレクトリ)。
export function shouldFormat(absFilePath, projectRoot, userHome = homedir(), ruleDirs = [".claude"]) {
  if (!projectRoot || !isAbsolute(absFilePath)) return false;
  const rel = relative(projectRoot, absFilePath);
  if (rel.startsWith("..") || isAbsolute(rel)) return false;

  for (const dir of ruleDirs) {
    if (ruleMatches(resolve(projectRoot, dir, "rules/markdown.md"), rel)) return true;
  }

  for (const dir of ruleDirs) {
    if (ruleMatches(resolve(userHome, dir, "rules/markdown.md"), rel)) return true;
  }

  return false;
}
