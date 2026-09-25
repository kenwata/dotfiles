// TODO.md の T 行を鍵に三方併合する git merge driver。
// <base> <ours> <theirs>（git の %O %A %B）を受け、結果を <ours> へ上書きする。
// 終了コードは 0 が併合、1 が鍵の衝突（衝突した鍵には ours の行）、
// git merge-file に落ちた時はその終了コード、引数の数の誤りは 2。
// 同じ T の行が 2 回ある時、または骨格が両側で変わった時は git merge-file に落ちる。
// stderr は鍵の併合時に `[merge-todo] 鍵の併合`、git merge-file 時に
// `[merge-todo] git merge-file に落ちた: <理由>` で始まる。
// T 行の判定の正は ../../check-task-scope.mjs の readTaskScope。

import fs from "node:fs";
import { spawnSync } from "node:child_process";

const TASK_ROW_STATUS = /\|\s*\[( |x|-)\]\s*\|/;

// 入力を行末の種類を保った行へ分割する。
function splitLines(text) {
  if (text.length === 0) return [];

  return [...text.matchAll(/([^\r\n]*)(\r\n|\r|\n|$)/g)]
    .filter((match) => match[0].length > 0)
    .map(([, content, ending]) => ({ content, ending }));
}

// T 行を読み取り、骨格内では T<n> の鍵として扱う。
// セルと状態の判定は readTaskScope と同じ規則にする。
function parseVersion(text) {
  const tasks = new Map();
  const skeleton = [];
  let duplicates = false;

  for (const { content, ending } of splitLines(text)) {
    const task = content.split("|").map((cell) => cell.trim()).find((cell) => /^T\d+$/.test(cell));
    if (!task || !TASK_ROW_STATUS.test(content)) {
      skeleton.push({ kind: "text", content, ending });
      continue;
    }

    if (tasks.has(task)) duplicates = true;
    tasks.set(task, content);
    skeleton.push({ kind: "task", task, ending });
  }

  return { skeleton, tasks, duplicates };
}

// git の通常の三方行併合を実行し、結果を ours へ書く。
function fallBackToGit(paths, reason) {
  const [base, ours, theirs] = paths;
  const result = spawnSync("git", ["merge-file", "-p", ours, base, theirs], { encoding: "buffer" });
  if (result.error) throw result.error;

  fs.writeFileSync(ours, result.stdout);
  process.stderr.write(`[merge-todo] git merge-file に落ちた: ${reason}\n`);
  return result.status ?? 1;
}

// 1つの T<n> 行を三方併合し、両側の異なる変更では ours を残す。
function mergeTaskRow(base, ours, theirs) {
  if (ours === theirs) return { row: ours, conflict: false };
  if (ours === base) return { row: theirs, conflict: false };
  if (theirs === base) return { row: ours, conflict: false };
  return { row: ours, conflict: true };
}

// 採用した骨格へ選択済みの T 行を戻し、全文を組み立てる。
function render(skeleton, rows) {
  return skeleton.map((line) => {
    const content = line.kind === "task" ? rows.get(line.task) : line.content;
    return `${content ?? ""}${line.ending}`;
  }).join("");
}

// base・ours・theirs の内容を併合し、結果を ours へ書いて終了コードを返す。
function mergeTodo(paths) {
  const [basePath, oursPath, theirsPath] = paths;
  const versions = [basePath, oursPath, theirsPath].map((file) =>
    parseVersion(fs.readFileSync(file, "utf8")));
  if (versions.some((version) => version.duplicates)) {
    return fallBackToGit(paths, "同じ T の行が 2 回ある");
  }

  const [base, ours, theirs] = versions;
  const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
  let skeleton;
  if (same(ours.skeleton, base.skeleton)) skeleton = theirs.skeleton;
  else if (same(theirs.skeleton, base.skeleton)) skeleton = ours.skeleton;
  else if (same(ours.skeleton, theirs.skeleton)) skeleton = ours.skeleton;
  else return fallBackToGit(paths, "骨格が両側で変わった");

  const keys = skeleton.filter((line) => line.kind === "task").map((line) => line.task);
  const mergedRows = new Map();
  const conflicts = [];
  for (const key of keys) {
    const merged = mergeTaskRow(base.tasks.get(key), ours.tasks.get(key), theirs.tasks.get(key));
    mergedRows.set(key, merged.row);
    if (merged.conflict) conflicts.push(key);
  }

  fs.writeFileSync(oursPath, render(skeleton, mergedRows));
  const conflictMessage = conflicts.length ? `: 衝突 ${conflicts.join(", ")}` : "";
  process.stderr.write(`[merge-todo] 鍵の併合${conflictMessage}\n`);
  return conflicts.length ? 1 : 0;
}

const paths = process.argv.slice(2);
if (paths.length !== 3) {
  process.stderr.write("使い方: node merge-todo.mjs <base> <ours> <theirs>\n");
  process.exitCode = 2;
} else {
  process.exitCode = mergeTodo(paths);
}
