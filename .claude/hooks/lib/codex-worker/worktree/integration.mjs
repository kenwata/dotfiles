// @ts-check

// worktree 統合の前提を検査し、fast-forward と後始末を行う。

import fs from "node:fs";
import { canonical } from "../../../check-task-scope.mjs";
import {
  git,
  hasProcessExitStatus,
  isMainHeadAncestor,
  listedWorktrees,
  localBranchExists,
  processErrorText,
  symbolicHead,
} from "../git.mjs";
import { isRealDirectory, isSymbolicLink } from "./paths.mjs";
import {
  shellArgument,
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  worktreeRecordReadRefusal,
  worktreeRefusal,
  readWorktreeRecord,
} from "./record.mjs";

/** @typedef {import("./record.mjs").WorktreeRecord} WorktreeRecord */
/**
 * @typedef {object} IntegrationReport
 * @property {string} task Task identifier.
 * @property {string} repo Main repository path.
 * @property {string} branch Integrated task branch.
 * @property {number} commits Number of commits added to main.
 * @property {string} head Main HEAD after integration.
 */
/** @typedef {{ ok: true, report: IntegrationReport }} IntegrateWorktreeSuccess */
/** @typedef {{ ok: false, code: 1 | 2, errors: string[] }} IntegrateWorktreeRefusal */
/** @typedef {IntegrateWorktreeSuccess | IntegrateWorktreeRefusal} IntegrateWorktreeResult */

/** Return a code 1 refusal when Git cannot fast-forward the main repository.
 * @param {unknown} error
 * @returns {IntegrateWorktreeRefusal}
 */
function integrationFailure(error) {
  return { ok: false, code: 1, errors: [processErrorText(error)] };
}

/** Return a safety issue when the recorded worktree is not ready for Git integration.
 * @param {{ root: string, task: string, record: WorktreeRecord, repo: string }} options
 * @returns {string | null}
 */
function integrationPreconditionProblem({ root, task, record, repo }) {
  const target = worktreeDir(root, task);
  const expectedPath = canonical(target);
  if (isSymbolicLink(target)) {
    return "置き場がシンボリックリンクのため統合できません";
  }

  if (canonical(record.path) !== expectedPath) {
    return "記録された worktree の置き場が一致しません";
  }
  if (canonical(record.repo) !== repo) return "記録の本体リポジトリが一致しません";
  if (record.branch !== worktreeBranch(root, task)) {
    return "記録のブランチがタスクのブランチと一致しません";
  }

  const entry = listedWorktrees(repo).find((item) => item.path === expectedPath);
  if (entry === undefined) {
    return "記録された worktree が本体の worktree list にありません";
  }
  if (entry.branch !== `refs/heads/${record.branch}`) {
    return "worktree の HEAD が記録のブランチと違います";
  }
  if (!isRealDirectory(record.path)) {
    return "記録された worktree のディレクトリがありません";
  }
  if (git(record.path, ["status", "--porcelain"]) !== "") {
    return `worktree が clean ではありません。監督が自分の変えたファイルをパス指定でコミットしてから統合してください`;
  }

  const currentRef = symbolicHead(repo);
  if (currentRef === null || currentRef !== record.base_ref) {
    return "本体のブランチが記録時の base_ref と一致しません";
  }
  if (!localBranchExists(repo, record.branch)) {
    return "記録されたブランチが本体にありません";
  }
  return null;
}

/** Fast-forward a clean task branch into its recorded main repository and remove task state.
 * This handles Git state only; lock checks and worklog writes belong to the caller.
 * @param {{ root: string, task: string }} options
 * @returns {IntegrateWorktreeResult} Integration report or a code 1/2 refusal.
 * @throws {Error} If a Git or filesystem operation fails outside expected merge refusal.
 */
export function integrateWorktree({ root, task }) {
  /** @type {WorktreeRecord | null} */
  let record;
  try {
    record = readWorktreeRecord(root, task);
  } catch (error) {
    const refusalResult = worktreeRecordReadRefusal(error);
    if (refusalResult !== null) return refusalResult;
    throw error;
  }
  if (record === null) {
    return { ok: false, code: 2, errors: ["worktree の記録がありません"] };
  }

  /** @type {string} */
  let repo;
  try {
    repo = canonical(git(record.repo, ["rev-parse", "--show-toplevel"]).trim());
  } catch (error) {
    if (hasProcessExitStatus(error)) {
      return worktreeRefusal(
        `記録の本体リポジトリを開けません: ${processErrorText(error)}`,
      );
    }
    throw error;
  }

  const problem = integrationPreconditionProblem({ root, task, record, repo });
  if (problem !== null) return { ok: false, code: 2, errors: [problem] };

  const mainHead = git(repo, ["rev-parse", "HEAD"]).trim();
  if (!isMainHeadAncestor(repo, mainHead, record.branch)) {
    const baseBranch = record.base_ref.slice("refs/heads/".length);
    const command = `git -C ${shellArgument(record.path)} rebase ${baseBranch}`;
    return {
      ok: false,
      code: 1,
      errors: [`本体が先に進んでいます。監督が実行してください: ${command}`],
    };
  }

  const commits = Number(git(repo, ["rev-list", "--count", `HEAD..${record.branch}`]).trim());
  try {
    git(repo, ["merge", "--ff-only", record.branch]);
  } catch (error) {
    if (!hasProcessExitStatus(error)) throw error;
    return integrationFailure(error);
  }

  const head = git(repo, ["rev-parse", "HEAD"]).trim();
  git(repo, ["worktree", "remove", record.path]);
  git(repo, ["branch", "-d", record.branch]);
  fs.unlinkSync(worktreeRecordPath(root, task));

  return { ok: true, report: { task, repo, branch: record.branch, commits, head } };
}
