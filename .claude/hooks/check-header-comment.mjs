#!/usr/bin/env node
// PreToolUse(Write|Edit / apply_patch) hook: 冒頭の規約コメントを本文の編集から守る
//
// HANDOFF.md・TODO.md・docs/design/*.md・docs/architecture.md・docs/decisions.md は、冒頭の HTML コメントに
// 自分の書式規約と雛形を持つ(templates/skeletons/ の設計。規約を別ファイルに置くと参照が循環して実体が
// 消えた実例があるため、ファイル自身に同梱する)。雛形は本文と同じ見出し(字下げ付き)を含むので、本文を
// 全体上書きする時に見出しを行頭アンカー無しで探すと雛形の行が先に当たり、そこから後ろ(コメントの残り・
// 閉じタグ・本文の先頭)が消える。2026-09-25 の HANDOFF.md ほか、複数のプロジェクトで繰り返し起きた。
// 本 hook は「本文を変える書き込みでは、冒頭のコメント塊は 1 バイトも変わらない」を書く前に機械で守る。
//
// 動作:
// - 対象: `.md` で、現在の内容が「最初の本文行(空行と見出し以外)より前に始まる `<!-- … -->` 塊」を
//   持つファイルだけ。それ以外(コメントの無い .md、.md 以外、新規ファイル)には何もしない
// - Write は content、Edit は old_string → new_string の置換、Codex の apply_patch は hunk の適用で
//   書き込み後の内容を求め、現在の内容と比べる。求められない時(old_string が無い・一意でない、hunk の
//   位置が見つからない)は何もしない(ツール自身が失敗するか、判定できないため。fail open)
// - 拒否: 書き込み後にコメント塊が先頭から消える、閉じタグ `-->` が無くなる、またはコメントと本文の
//   両方が変わる。コメントだけを直す編集(規約の改訂)と、本文だけの編集は通す
//
// 出力規約: 対象外なら何も出力しない。いかなる場合も exit 0(拒否は permissionDecision で表す)。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const OPEN_TAG = "<!--";
const CLOSE_TAG = "-->";

/** @typedef {{ prefix: string[], comment: string[], closed: boolean, body: string[] }} LeadingComment */

/**
 * 冒頭のコメント塊を切り出す。塊より前に置けるのは空行と見出し(`#` で始まる行)だけ。
 * @param {string} text
 * @returns {LeadingComment | null} 塊が無ければ null。閉じタグが無ければ closed: false で残りを comment に入れる
 */
export function leadingComment(text) {
  const lines = text.split("\n");
  let start = 0;
  while (start < lines.length && (lines[start].trim() === "" || lines[start].startsWith("#"))) start += 1;
  if (start >= lines.length || !lines[start].startsWith(OPEN_TAG)) return null;

  const end = lines.findIndex((line, index) => index >= start && closesComment(line, index === start));
  if (end === -1) {
    return { prefix: lines.slice(0, start), comment: lines.slice(start), closed: false, body: [] };
  }

  return {
    prefix: lines.slice(0, start),
    comment: lines.slice(start, end + 1),
    closed: true,
    body: lines.slice(end + 1),
  };
}

/** 行がコメントを閉じるか。開始行では `<!--` より後ろに `-->` がある時だけ閉じる(1 行コメント)。 */
function closesComment(line, isOpeningLine) {
  if (!isOpeningLine) return line.includes(CLOSE_TAG);
  return line.indexOf(CLOSE_TAG, OPEN_TAG.length) !== -1;
}

/**
 * 書き込み後の内容が冒頭のコメント塊を壊すかを判定する。
 * @param {string} before 現在の内容
 * @param {string} after 書き込み後の内容
 * @returns {string | null} 拒否の理由。問題なければ null
 */
export function violation(before, after) {
  const current = leadingComment(before);
  if (current === null || !current.closed) return null;

  const next = leadingComment(after);
  if (next === null) return "書き込み後の先頭(空行と見出しより前)に規約コメントが無い";
  if (!next.closed) return `書き込み後の規約コメントに閉じタグ \`${CLOSE_TAG}\` が無い(途中から本文で上書きされている)`;

  const commentChanged = current.comment.join("\n") !== next.comment.join("\n");
  const bodyChanged = bodyText(current) !== bodyText(next);
  if (commentChanged && bodyChanged) return "規約コメントと本文の両方が変わる";
  return null;
}

/** コメント塊の外側(見出しの前置きと本文)を 1 つの文字列にする。 */
function bodyText(parsed) {
  return [...parsed.prefix, ...parsed.body].join("\n");
}

/**
 * Edit ツールの置換を適用する。old_string が無い・一意でない(replace_all 無し)時は null。
 * @param {string} before
 * @param {{ old_string?: string, new_string?: string, replace_all?: boolean }} input
 * @returns {string | null}
 */
export function applyEdit(before, input) {
  const oldString = input.old_string ?? "";
  const newString = input.new_string ?? "";
  if (oldString === "") return null;

  const occurrences = before.split(oldString).length - 1;
  if (occurrences === 0) return null;
  if (occurrences > 1 && !input.replace_all) return null;
  if (input.replace_all) return before.split(oldString).join(newString);

  return before.replace(oldString, () => newString);
}

/**
 * Codex の apply_patch(V4A 形式)から、`*** Update File:` ごとの hunk 行を集める。
 * @param {string} patch
 * @returns {{ file: string, hunk: string[] }[]}
 */
export function updateSections(patch) {
  const sections = [];
  let current = null;

  for (const line of patch.split(/\r?\n/)) {
    const header = line.match(/^\*\*\* Update File: (.+)$/);
    if (header) {
      current = { file: header[1], hunk: [] };
      sections.push(current);
      continue;
    }
    if (line.startsWith("*** ")) {
      // Move to / End of File は位置に影響しない。Add・Delete・End Patch でこの節は終わる
      if (!line.startsWith("*** Move to:") && !line.startsWith("*** End of File")) current = null;
      continue;
    }
    if (current) current.hunk.push(line);
  }

  return sections;
}

/**
 * hunk を適用する。各 hunk は `@@` で始まり、` `(文脈)・`-`(削除)・`+`(追加)の行が続く。
 * 文脈と削除の並びを前の hunk の位置以降で最初に一致する場所に当てる。見つからなければ null。
 * @param {string} before
 * @param {string[]} hunkLines
 * @returns {string | null}
 */
export function applyHunks(before, hunkLines) {
  const source = before.split("\n");
  const output = [];
  let position = 0;

  for (const hunk of splitHunks(hunkLines)) {
    if (hunk.anchor !== null) {
      const anchorIndex = source.indexOf(hunk.anchor, position);
      if (anchorIndex === -1) return null;
      position = anchorIndex + 1;
    }

    const search = hunk.lines.filter((line) => !line.startsWith("+")).map((line) => line.slice(1));
    const replacement = hunk.lines.filter((line) => !line.startsWith("-")).map((line) => line.slice(1));
    const found = findSequence(source, search, position);
    if (found === -1) return null;

    output.push(...source.slice(position, found), ...replacement);
    position = found + search.length;
  }

  output.push(...source.slice(position));
  return output.join("\n");
}

/** `@@` 行で hunk を区切る。`@@ <行>` の形なら、その行を先に探す anchor にする。 */
function splitHunks(hunkLines) {
  const hunks = [];
  for (const line of hunkLines) {
    if (line.startsWith("@@")) {
      const anchor = line.slice(2).trim();
      hunks.push({ anchor: anchor === "" ? null : anchor, lines: [] });
      continue;
    }
    if (hunks.length === 0) hunks.push({ anchor: null, lines: [] });
    if (line.startsWith(" ") || line.startsWith("-") || line.startsWith("+")) hunks[hunks.length - 1].lines.push(line);
  }

  return hunks.filter((hunk) => hunk.lines.length > 0);
}

/** 行の並び needle が haystack の from 以降で最初に現れる位置。無ければ -1。空の needle は from。 */
function findSequence(haystack, needle, from) {
  if (needle.length === 0) return from;
  for (let index = from; index + needle.length <= haystack.length; index += 1) {
    if (needle.every((line, offset) => haystack[index + offset] === line)) return index;
  }

  return -1;
}

/**
 * ツール入力から (ファイルの絶対パス, 書き込み後の内容を求める関数) の組を作る。
 * @param {{ tool_name?: string, tool_input?: Record<string, unknown>, cwd?: string }} input
 * @returns {{ file: string, after: (before: string) => string | null }[]}
 */
function plannedWrites(input) {
  const cwd = typeof input.cwd === "string" ? input.cwd : process.cwd();
  const toolInput = input.tool_input ?? {};
  const resolve = (file) => path.resolve(cwd, String(file));

  if (input.tool_name === "Write" && typeof toolInput.file_path === "string") {
    return [{ file: resolve(toolInput.file_path), after: () => String(toolInput.content ?? "") }];
  }
  if (input.tool_name === "Edit" && typeof toolInput.file_path === "string") {
    return [{ file: resolve(toolInput.file_path), after: (before) => applyEdit(before, toolInput) }];
  }
  if (input.tool_name === "apply_patch" && typeof toolInput.command === "string") {
    return updateSections(toolInput.command).map(({ file, hunk }) => ({
      file: resolve(file),
      after: (before) => applyHunks(before, hunk),
    }));
  }

  return [];
}

/** 拒否の理由。読み手はこの hook を初めて見るエージェントなので、何が起きたかと正しい手順を書く。 */
function denyMessage(file, current, reason) {
  const first = current.prefix.length + 1;
  const last = current.prefix.length + current.comment.length;
  return [
    `\`${file}\` の冒頭の規約コメント(${first}〜${last} 行目)を本文の編集で壊そうとしています: ${reason}。`,
    "規約コメントは本文を変える書き込みでは 1 バイトも変えない。",
    `全体上書きの時は \`${CLOSE_TAG}\` より前を現物のまま含める。`,
    "コメントの中の雛形行(字下げされた `## …` や `目標:`)は本文の見出しではない。本文の見出しは行頭で探す。",
    "規約コメント自体を直す時は、本文を変えない編集に分ける。",
  ].join(" ");
}

function emitDeny(reason) {
  const hookSpecificOutput = {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  };
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

/** 1 つの書き込み予定を検査し、拒否の文を返す(問題なければ null)。 */
function inspect({ file, after }) {
  if (path.extname(file) !== ".md") return null;

  let before;
  try {
    before = fs.readFileSync(file, "utf8");
  } catch {
    return null;
  }

  const current = leadingComment(before);
  if (current === null || !current.closed) return null;
  const next = after(before);
  if (next === null) return null;

  const reason = violation(before, next);
  return reason === null ? null : denyMessage(file, current, reason);
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }

  const reasons = plannedWrites(input).map(inspect).filter((reason) => reason !== null);
  if (reasons.length > 0) emitDeny(reasons.join("\n"));
}

const executedPath = process.argv[1];

if (
  executedPath &&
  fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(executedPath)
) {
  main();
}
