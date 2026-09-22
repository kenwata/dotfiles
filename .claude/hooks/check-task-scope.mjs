#!/usr/bin/env node
// UserPromptSubmit + PreToolUse(Write|Edit / apply_patch) hook: /execute-task の対象パス検査
//
// 2026-09-22、Codex(gpt-5.6-luna)が `$execute-task T43` で、対象パスが
// `src/ai-workflows/contracts/` と `tests/ai-workflows/` だけのタスクなのに、入力契約の変更を
// 呼び出し元(`src/area-analysis/audit/context.ts`)まで連鎖させて 19 ファイルを変更し、
// コンテキスト 82% で利用者が止めた。execute-task の文章は「設計の穴なら止まれ」と書いていたが、
// 対象パスを機械的に検査する層が無く、文章だけが境界だった。本 hook はその境界を機構へ移す。
//
// 動作:
// - UserPromptSubmit: プロンプトが `/execute-task T<n>`(Codex は `$execute-task T<n>`)なら、
//   セッション単位の状態ファイルへ実行中の T とプロジェクトルートを記録する。別のスラッシュ
//   コマンド / スキル呼び出し(`/foo`・`$foo`)が来たら状態を消す。素のプロンプトは状態を保つ。
// - PreToolUse: 状態があり、TODO.md でその T が未完了(`[ ]`)の間だけ、完了条件ブロックの
//   `対象:` に列挙されたパスを読み、編集先がその外なら拒否する。`対象:` に散文の項目
//   (例「選定試験」)が混ざる T は機械判定できないので警告(additionalContext)に落とす。
//   常時許可: TODO.md / HANDOFF.md / docs/decisions.md / docs/architecture.md / docs/design/
//   (参照の訂正・穴の記録・判断ログの経路)。プロジェクトルート外のパス(scratchpad 等)は対象外。
//
// - SubagentStart / SubagentStop: agent_type がレビュー役(proposal-reviewer / diff-reviewer。Codex は
//   proposal_reviewer / diff_reviewer)なら「レビュー待ち」フラグをセッション単位に置き、Stop で消す。
//   フラグがある間、主文脈(agent_id の無い呼び出し)の編集を拒否する(2026-09-22 のログで、Codex が
//   「レビュー待ちの間に」実装を始め、レビュー役の「先に確定が必要」を裁量と読み替えて続行した)。
//   Stop が届かなかった時の保険として 30 分で失効。/execute-task 実行中かどうかは問わない
//   (レビュー対象を途中で変えればレビュー自体が無効になるので、コマンドに依らず成り立つ)。
//
// 既知の限界: Bash 経由(sed / heredoc / mv)の編集は検知しない。対象パスの内側での過剰変更は
// 止められない(/breakdown の「裁量は対象パスの中で閉じる」規則と Codex スキルの文章に依る)。
// 状態はセッション ID 単位で、12 時間で失効する。
//
// 出力規約: 対象外なら何も出力しない。いかなる場合も exit 0(拒否は permissionDecision で表す)。
// Claude と Codex は同じ JSON 形を使うため、本体を共有し、ホスト側ラッパーは node を起動するだけ。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";

const STATE_TTL_MS = 12 * 60 * 60 * 1000;
const REVIEW_TTL_MS = 30 * 60 * 1000;
const REVIEW_AGENTS = new Set(["proposal-reviewer", "diff-reviewer", "proposal_reviewer", "diff_reviewer"]);
const ALWAYS_ALLOWED = ["TODO.md", "HANDOFF.md", "docs/decisions.md", "docs/architecture.md", "docs/design/"];

export function stateDir() {
  return path.join(process.env.TMPDIR || os.tmpdir(), "claude-task-scope");
}

function stateKey(input) {
  if (input.session_id) return String(input.session_id).replace(/[^A-Za-z0-9._-]/g, "_");
  const cwd = input.cwd || process.cwd();
  return "cwd-" + createHash("sha1").update(cwd).digest("hex").slice(0, 16);
}

function statePath(input) {
  return path.join(stateDir(), `${stateKey(input)}.json`);
}

function gitRoot(dir) {
  try {
    return execFileSync("git", ["-C", dir, "rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

// `/execute-task T43` / `$execute-task T43` → "T43"。それ以外のコマンド → "other"。素の文 → null
export function classifyPrompt(prompt) {
  const text = String(prompt || "").trim();
  const execute = text.match(/^[/$]execute-task\s+(T\d+)\b/);
  if (execute) return execute[1];
  if (/^[/$][a-z][a-z0-9-]*/.test(text)) return "other";
  return null;
}

function handlePrompt(input) {
  const kind = classifyPrompt(input.prompt);
  const file = statePath(input);
  if (kind === null) return;
  if (kind === "other") {
    try { fs.rmSync(file, { force: true }); } catch { /* 状態が無ければ何もしない */ }
    return;
  }
  const cwd = input.cwd || process.cwd();
  const root = gitRoot(cwd) || cwd;
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, JSON.stringify({ task: kind, root, at: Date.now() }));
}

function reviewFlagPath(input, agentId) {
  const id = String(agentId || "unknown").replace(/[^A-Za-z0-9._-]/g, "_");
  return path.join(stateDir(), `${stateKey(input)}.review-${id}`);
}

function handleSubagentStart(input) {
  if (!REVIEW_AGENTS.has(String(input.agent_type || ""))) return;
  fs.mkdirSync(stateDir(), { recursive: true, mode: 0o700 });
  fs.writeFileSync(reviewFlagPath(input, input.agent_id), String(input.agent_type));
}

function handleSubagentStop(input) {
  try { fs.rmSync(reviewFlagPath(input, input.agent_id), { force: true }); } catch { /* 無ければ何もしない */ }
}

// 走行中のレビュー役の agent_type を返す(失効したフラグは掃除する)
export function pendingReviews(input) {
  const prefix = `${stateKey(input)}.review-`;
  const pending = [];
  let entries;
  try { entries = fs.readdirSync(stateDir()); } catch { return pending; }
  for (const name of entries) {
    if (!name.startsWith(prefix)) continue;
    const file = path.join(stateDir(), name);
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > REVIEW_TTL_MS) { fs.rmSync(file, { force: true }); continue; }
      pending.push(fs.readFileSync(file, "utf8").trim() || "reviewer");
    } catch { /* 競合で消えた場合は無視 */ }
  }
  return pending;
}

function reviewDenyMessage(agents) {
  return (
    `レビュー役(${agents.join(", ")})の返答待ちです。返答が届くまで編集しないこと。` +
    "返答が『先に設計で確定が必要』なら穴の記録の経路、そうでなければ返答を一次証拠で確認してから実装する"
  );
}

function loadState(input) {
  try {
    const state = JSON.parse(fs.readFileSync(statePath(input), "utf8"));
    if (!state.task || !state.root || Date.now() - (state.at || 0) > STATE_TTL_MS) return null;
    return state;
  } catch {
    return null;
  }
}

// TODO.md から対象 T の状態と `対象:` を読む。
// 戻り値: { open: boolean, paths: string[], prose: string[] } / T が見つからなければ null
export function readTaskScope(todoText, task) {
  const idPattern = new RegExp(`(^|[^0-9A-Za-z])${task}([^0-9]|$)`);
  const lines = todoText.split(/\r?\n/);
  const row = lines.find((line) => /^\|/.test(line) && idPattern.test(line) && /\|\s*\[( |x|-)\]\s*\|/.test(line));
  if (!row) return null;
  const open = /\|\s*\[ \]\s*\|/.test(row);

  const block = lines.find((line) => new RegExp(`^\\*\\*#[^*]*/\\s*${task}\\*\\*`).test(line));
  const target = block ? block.match(/対象:\s*([^。]*)。/) : null;
  if (!target) return { open, paths: [], prose: [], declared: false };

  const paths = [];
  const prose = [];
  for (const raw of target[1].split(/、|,|\s+と\s+/)) {
    const item = raw.trim();
    if (!item) continue;
    // `パス` だけ、または `パス`(注記) の形をパスとして読む(注記は判定に使わない)
    const code = item.match(/^`([^`]+)`(?:\s*[（(].*[)）])?$/);
    if (code) paths.push(code[1]);
    else prose.push(item);
  }
  return { open, paths, prose, declared: true };
}

function patchTargets(patch) {
  const targets = [];
  for (const line of String(patch || "").split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) || line.match(/^\*\*\* Move to: (.+)$/);
    if (match) targets.push(match[1].trim());
  }
  return [...new Set(targets)];
}

function editTargets(input) {
  const tool = input.tool_name || "";
  const toolInput = input.tool_input || {};
  if (tool === "apply_patch") return patchTargets(toolInput.command || toolInput.patch || "");
  if (toolInput.file_path) return [String(toolInput.file_path)];
  return [];
}

function isInside(relative, scopePath, root) {
  const scope = scopePath.replace(/^\.\//, "");
  if (relative === scope) return true;
  let isDir = scope.endsWith("/");
  if (!isDir) {
    try { isDir = fs.statSync(path.join(root, scope)).isDirectory(); } catch { isDir = false; }
  }
  const prefix = scope.endsWith("/") ? scope : `${scope}/`;
  return isDir && relative.startsWith(prefix);
}

// 未作成のパスも扱えるよう、実在する最も深い祖先までを実体パスへ解決して残りを付け直す
// (macOS の /var → /private/var のように、git の返すルートと入力パスの解決状態が違うため)
function canonical(absolute) {
  let existing = absolute;
  let tail = "";
  while (!fs.existsSync(existing)) {
    const parent = path.dirname(existing);
    if (parent === existing) return absolute;
    tail = path.join(path.basename(existing), tail);
    existing = parent;
  }
  return path.join(fs.realpathSync(existing), tail);
}

export function checkTargets(targets, scope, root, cwd) {
  const violations = [];
  const realRoot = canonical(root);
  for (const target of targets) {
    const absolute = canonical(path.resolve(cwd, target));
    const relative = path.relative(realRoot, absolute).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) continue; // プロジェクト外は対象外
    const allowed = [...ALWAYS_ALLOWED, ...scope.paths].some((p) => isInside(relative, p, root));
    if (!allowed) violations.push(relative);
  }
  return violations;
}

function denyMessage(task, scope, violations) {
  const list = [...scope.paths.map((p) => `\`${p}\``), ...scope.prose].join("、");
  return (
    `${task} の対象パス外への編集です: ${violations.join(", ")}。対象: ${list}。` +
    "利用者に問わず自分で判定すること — " +
    "(a) 対象の記述がリポジトリの現物に照らして機械的に誤りなら、参照の訂正として TODO.md の対象だけを直し docs/decisions.md に 1 行書いて再試行する。" +
    "(b) 対象外の変更が要る(入力契約の変更が呼び出し元へ波及する等)なら設計の穴: 対象外の変更は行わず、HANDOFF.md の仕掛かり中に穴の記録を書き、T を未完了のまま止めて /amend へ渡す。" +
    "改善案は報告の末尾か要確認に回す"
  );
}

function emit(output) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", ...output } }));
}

function handleToolUse(input) {
  const targets = editTargets(input);
  if (targets.length === 0) return;

  // レビュー待ち: 主文脈(agent_id 無し)の編集だけを止める。子エージェントの編集は通す
  if (!input.agent_id) {
    const reviews = pendingReviews(input);
    if (reviews.length > 0) {
      emit({ permissionDecision: "deny", permissionDecisionReason: reviewDenyMessage(reviews) });
      return;
    }
  }

  const state = loadState(input);
  if (!state) return;

  let todoText;
  try {
    todoText = fs.readFileSync(path.join(state.root, "TODO.md"), "utf8");
  } catch {
    return;
  }
  const scope = readTaskScope(todoText, state.task);
  if (!scope || !scope.open || !scope.declared) return;

  const cwd = input.cwd || process.cwd();
  const violations = checkTargets(targets, scope, state.root, cwd);
  if (violations.length === 0) return;

  const message = denyMessage(state.task, scope, violations);
  const output = scope.prose.length === 0
    ? { permissionDecision: "deny", permissionDecisionReason: message }
    : { additionalContext: `(対象に散文の項目があるため警告のみ。拒否にするには対象を \`パス\` だけで書く) ${message}` };
  emit(output);
}

function main() {
  let input;
  try {
    input = JSON.parse(fs.readFileSync(0, "utf8"));
  } catch {
    return;
  }
  const event = input.hook_event_name || (input.prompt !== undefined ? "UserPromptSubmit" : "PreToolUse");
  if (event === "UserPromptSubmit") handlePrompt(input);
  else if (event === "PreToolUse") handleToolUse(input);
  else if (event === "SubagentStart") handleSubagentStart(input);
  else if (event === "SubagentStop") handleSubagentStop(input);
}

// ラッパーからシンボリックリンク経由で起動されても本体と判定できるよう実体パスで比べる
let invokedDirectly = false;
try {
  invokedDirectly = Boolean(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url));
} catch {
  invokedDirectly = false;
}
if (invokedDirectly) main();
