// Codex worker runner の中核: 作業ツリーの snapshot / ゲート / restore、worker に渡す規約の選択、
// rollout からのコンテキスト使用率の抽出、プロンプトの組み立て。起動と後始末は cli.mjs が行う。
// 判定の正本(対象パスの読み方・包含判定)は ../../check-task-scope.mjs を共用する。

import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { canonical, isInside, readTaskScope } from "../../check-task-scope.mjs";

// worker の変更先として許さないパス(状態文書と設計書は監督だけが書く)
export const FORBIDDEN_FOR_WORKER = ["TODO.md", "HANDOFF.md", "docs/decisions.md", "docs/architecture.md", "docs/design/", "plan.md"];
const RULE_DIRS = [".claude/rules", ".codex/rules"];

function git(root, args, input) {
  return execFileSync("git", ["-C", root, ...args], {
    input,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
  });
}

function sha1(text) {
  return createHash("sha1").update(text).digest("hex");
}

// snapshot とゲートが追うパス: 未コミット(変更・削除・untracked。rename は削除と追加に分ける)と、
// .gitignore 対象の項目。ignored は -u normal で取り、無視されたディレクトリは 1 項目(中身の変更までは追わない。
// 存在の出入りだけを見る)にまとめる。-u all で取ると node_modules などを全ファイル列挙してしまう
export function trackedPaths(root) {
  const parse = (out) => out.split("\0").filter(Boolean).map((entry) => ({
    path: entry.slice(3).replace(/\/$/, ""), ignored: entry.startsWith("!!"),
  }));
  const dirty = parse(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--no-renames"]));
  const ignored = parse(git(root, ["status", "--porcelain=v1", "-z", "--untracked-files=normal", "--ignored=traditional", "--no-renames"]))
    .filter((e) => e.ignored);
  return [...dirty, ...ignored];
}

export function dirtyPaths(root) {
  return trackedPaths(root).map((e) => e.path);
}

const modeOf = (stat) => ((stat.mode & 0o111) !== 0 ? "755" : "644");

// 入れ子のリポジトリ(サブモジュール、untracked の clone)は、その HEAD と作業ツリーの状態で比べる
function nestedRepoState(absolute) {
  // git -C は親のリポジトリへ遡るので、自身に .git(サブモジュールはファイル)を持つディレクトリだけを対象にする
  if (!fs.existsSync(path.join(absolute, ".git"))) return null;
  try {
    const head = execFileSync("git", ["-C", absolute, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    const status = execFileSync("git", ["-C", absolute, "status", "--porcelain=v1", "-z", "--untracked-files=all"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return "repo:" + sha1(head + "\0" + status);
  } catch {
    return null;
  }
}

// 作業ツリー上の状態。ファイルは「blob ハッシュ:実行権限」、リンクは参照先、ディレクトリは入れ子の
// リポジトリなら repo:…、それ以外は dir(.gitignore 対象のディレクトリ)。存在しなければ null
function worktreeStates(root, paths) {
  const result = new Map();
  const files = [];
  for (const p of paths) {
    const absolute = path.join(root, p);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch { result.set(p, null); continue; }
    if (stat.isSymbolicLink()) result.set(p, "link:" + sha1(fs.readlinkSync(absolute)));
    else if (stat.isFile()) files.push([p, modeOf(stat)]);
    else if (stat.isDirectory()) result.set(p, nestedRepoState(absolute) ?? "dir");
    else result.set(p, "other");
  }
  if (files.length > 0) {
    const hashes = git(root, ["hash-object", "--stdin-paths"], files.map(([p]) => p).join("\n") + "\n").trim().split("\n");
    files.forEach(([p, mode], i) => result.set(p, `${hashes[i]}:${mode}`));
  }
  return result;
}

// HEAD 上の状態(worktreeStates と同じ表し方)と、restore に要る mode・blob。HEAD に無ければ state は null
function headEntries(root, paths) {
  const result = new Map(paths.map((p) => [p, { state: null }]));
  if (paths.length === 0) return result;
  let out = "";
  try { out = git(root, ["ls-tree", "-r", "-z", "HEAD", "--", ...paths]); } catch { return result; }
  for (const entry of out.split("\0").filter(Boolean)) {
    const [meta, file] = entry.split("\t");
    const [mode, , hash] = meta.split(" ");
    if (!result.has(file)) continue;
    let state;
    if (mode === "120000") state = "link:" + sha1(git(root, ["cat-file", "blob", hash]));
    else if (mode === "160000") state = "gitlink:" + hash;
    else state = `${hash}:${mode === "100755" ? "755" : "644"}`;
    result.set(file, { state, mode, hash });
  }
  return result;
}

// HEAD・全 ref・index の指紋。worker による commit / stash / ブランチ操作 / add を検出する
export function repoFingerprint(root) {
  let head = "";
  try { head = git(root, ["rev-parse", "HEAD"]).trim(); } catch { head = "(no HEAD)"; }
  let symbolic = "";
  try { symbolic = git(root, ["symbolic-ref", "-q", "HEAD"]).trim(); } catch { symbolic = "(detached)"; }
  const refs = sha1(git(root, ["for-each-ref", "--format=%(refname) %(objectname)"]));
  const index = sha1(git(root, ["ls-files", "-s", "-z"]));
  return { head, symbolic, refs, index };
}

// run 前の状態を runDir に保存する。未コミット・ignored のファイルは内容も退避する(restore 用)
export function takeSnapshot(root, runDir) {
  const tracked = trackedPaths(root);
  const states = worktreeStates(root, tracked.map((e) => e.path));
  const filesDir = path.join(runDir, "files");
  fs.mkdirSync(filesDir, { recursive: true, mode: 0o700 });
  const files = {};
  tracked.forEach(({ path: p, ignored }, i) => {
    const state = states.get(p);
    let saved = null;
    if (state !== null && !state.startsWith("repo:") && state !== "dir" && state !== "other") {
      saved = path.join(filesDir, String(i));
      fs.cpSync(path.join(root, p), saved, { verbatimSymlinks: true });
    }
    files[p] = { state, saved, ignored };
  });
  const snapshot = { root, fingerprint: repoFingerprint(root), files, at: Date.now() };
  fs.writeFileSync(path.join(runDir, "snapshot.json"), JSON.stringify(snapshot, null, 2));
  return snapshot;
}

function baselineStates(snapshot, paths) {
  const notInSnapshot = paths.filter((p) => !(p in snapshot.files));
  const head = headEntries(snapshot.root, notInSnapshot);
  return new Map(paths.map((p) => [p, p in snapshot.files ? snapshot.files[p].state : head.get(p).state]));
}

// snapshot 以後に状態が変わった(追加・変更・削除・実行権限の変更)パス
export function changedSince(snapshot) {
  const candidates = [...new Set([...Object.keys(snapshot.files), ...dirtyPaths(snapshot.root)])];
  const current = worktreeStates(snapshot.root, candidates);
  const baseline = baselineStates(snapshot, candidates);
  return candidates.filter((p) => baseline.get(p) !== current.get(p)).sort();
}

// ゲート: HEAD・ref・index が不変で、変更がステップの許可パスの中だけにあること。
// .gitignore 対象のディレクトリの出入り(試験の生成物など)は違反にせず ignoredDirs として報告する
export function gate(snapshot, allow) {
  const now = repoFingerprint(snapshot.root);
  const before = snapshot.fingerprint;
  const repoChanges = ["head", "symbolic", "refs", "index"].filter((key) => before[key] !== now[key]);
  const changed = changedSince(snapshot);
  const current = worktreeStates(snapshot.root, changed);
  const isIgnoredDir = (p) => current.get(p) === "dir" || snapshot.files[p]?.state === "dir";
  const outside = changed.filter((p) => !allow.some((a) => isInside(p, a, snapshot.root)));
  const ignoredDirs = outside.filter(isIgnoredDir);
  const violations = outside.filter((p) => !isIgnoredDir(p));
  return { passed: repoChanges.length === 0 && violations.length === 0, repoChanges, changed, violations, ignoredDirs };
}

// 指定パスを snapshot 時点の状態へ戻す(snapshot 時に未コミット・ignored だったものは退避コピーから、それ以外は
// HEAD から、実行権限も含めて)。上書き・削除の前に、現在の内容を backupDir へ退避する(run 中に利用者が
// 加えた編集を失わないため)。ディレクトリ(入れ子のリポジトリ、サブモジュール、ignored のディレクトリ)は
// 消さずに unrestorable として返す
export function restore(snapshot, paths, backupDir) {
  const root = snapshot.root;
  const head = headEntries(root, paths.filter((p) => !(p in snapshot.files)));
  const restored = [];
  const unrestorable = [];
  const backups = {};
  paths.forEach((p, i) => {
    const absolute = path.join(root, p);
    const entry = snapshot.files[p];
    const baseline = entry ? entry.state : head.get(p).state;
    let stat = null;
    try { stat = fs.lstatSync(absolute); } catch { /* 無い */ }
    const isDirState = (s) => s !== null && (s === "dir" || s === "other" || s.startsWith("repo:") || s.startsWith("gitlink:"));
    if ((stat && stat.isDirectory()) || isDirState(baseline)) {
      unrestorable.push(p);
      return;
    }
    try {
      if (stat) {
        fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
        const backup = path.join(backupDir, String(i));
        fs.cpSync(absolute, backup, { verbatimSymlinks: true });
        backups[p] = backup;
        fs.rmSync(absolute, { force: true });
      }
      if (entry?.saved) {
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        fs.cpSync(entry.saved, absolute, { verbatimSymlinks: true });
      } else if (!entry && head.get(p).state !== null) {
        const { mode, hash } = head.get(p);
        fs.mkdirSync(path.dirname(absolute), { recursive: true });
        const blob = execFileSync("git", ["-C", root, "cat-file", "blob", hash], { maxBuffer: 256 * 1024 * 1024 });
        if (mode === "120000") fs.symlinkSync(blob.toString(), absolute);
        else {
          fs.writeFileSync(absolute, blob);
          fs.chmodSync(absolute, mode === "100755" ? 0o755 : 0o644);
        }
      }
      restored.push(p);
    } catch (error) {
      unrestorable.push(`${p}(${error.message})`);
    }
  });
  return { restored, unrestorable, backups };
}

// packet の必須の節。監督がステップをまたぐ決定を現物で確かめたかを、worker を起動する前に機械で問う
// (2026-09-23 の T55 で、確かめていない決定を packet に書いて手戻りを 4 回生んだため。/ruleize)
const PACKET_CROSS_CHECK_HEADING = "## 横断の確認";

const PACKET_CROSS_CHECK_REASON = `packet に「${PACKET_CROSS_CHECK_HEADING}」節が無いか空。次に当たる項目だけ中身を書き、どれにも当たらなければ「該当なし: <理由1文>」と書く。
1. packet が関数名・型・値の置き場・戻り値の種類を指定し、それを許可パスの外のファイルが作る・使う → 書く前に作り手と呼び出し元を検索し、「<識別子>: 作り手 <path:行> / 呼び出し元 <path:行>」と、呼び出し元の扱いをどのステップで指示するかを書く。
2. packet が不具合・遅さの原因を断定している → 根拠(計測の結果、または仮説3つ以上と棄却の理由)を書く。観測から直接読めないなら、先に「測って報告するだけ」のステップを起動する。
3. 複数ステップが共有する型・データ形式に触れる → 共有の一覧のどれに当たるかを書く。設計書が決めていない大きな共有形式を新たに固める時は、裁量で固めず穴の記録の経路へ戻す。`;

// packet の「## 横断の確認」節を検査する。節が無いか、次の同じ深さの見出しまでが空白だけなら理由を 1 件返す
export function checkPacketCrossCheck(packet) {
  const lines = packet.split("\n");
  const start = lines.findIndex((line) => line.trimEnd() === PACKET_CROSS_CHECK_HEADING);
  if (start === -1) return [PACKET_CROSS_CHECK_REASON];

  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^## /.test(line));
  const body = end === -1 ? rest : rest.slice(0, end);
  return body.some((line) => line.trim() !== "") ? [] : [PACKET_CROSS_CHECK_REASON];
}

// ステップの許可パスを検査する。errors があれば起動しない
// maxAllow: 1 ステップの許可パスの上限。対象パスをまとめて渡すと 1 回の起動の文脈量を抑えられないため、機械で制限する
export function checkAllow(root, task, allow, maxAllow = 3) {
  const errors = [];
  const warnings = [];
  if (allow.length === 0) errors.push("変更してよいパス(--allow)が 1 つも無い");
  if (allow.length > maxAllow) errors.push(`許可パスが ${allow.length} 件で上限 ${maxAllow} を超える。ステップを小さく切る`);
  for (const a of allow) {
    const relative = path.relative(canonical(root), canonical(path.resolve(root, a))).split(path.sep).join("/");
    if (relative.startsWith("..") || path.isAbsolute(relative)) errors.push(`プロジェクト外のパス: ${a}`);
    // 許可パスが禁止パスの中にある、または禁止パスを含む上位ディレクトリである(未作成でも判定できるよう文字列で比べる)
    const nests = (inner, outer) => inner === outer || inner.startsWith(`${outer}/`);
    const bareRelative = relative.replace(/\/$/, "");
    if (FORBIDDEN_FOR_WORKER.some((f) => nests(bareRelative, f.replace(/\/$/, "")) || nests(f.replace(/\/$/, ""), bareRelative))) {
      errors.push(`worker に許さないパス(状態文書・設計書)を含む: ${a}`);
    }
  }
  let todoText;
  try { todoText = fs.readFileSync(path.join(root, "TODO.md"), "utf8"); } catch { todoText = null; }
  const scope = todoText === null ? null : readTaskScope(todoText, task);
  if (!scope) errors.push(`TODO.md に ${task} が見つからない`);
  else if (!scope.open) errors.push(`${task} は未完了([ ])ではない`);
  else if (!scope.declared) warnings.push(`${task} に「対象:」が無い。ステップの許可パスと T の対象の包含は検査していない`);
  else {
    const bare = (p) => p.replace(/^\.\//, "").replace(/\/$/, "");
    const outside = allow.filter((a) => !scope.paths.some((p) => bare(a) === bare(p) || isInside(bare(a), p, root)));
    if (outside.length > 0) {
      const message = `T の対象の外: ${outside.join(", ")}`;
      if (scope.prose.length === 0) errors.push(message);
      else warnings.push(`${message}(対象に散文の項目 ${scope.prose.join("、")} があるため警告のみ)`);
    }
  }
  return { errors, warnings };
}

function ruleGlobs(text) {
  const front = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!front) return [];
  const globs = [];
  let inPaths = false;
  for (const line of front[1].split(/\r?\n/)) {
    if (/^paths:\s*$/.test(line)) { inPaths = true; continue; }
    if (inPaths) {
      const item = line.match(/^\s+-\s*["']?([^"']+?)["']?\s*$/);
      if (item) globs.push(item[1]);
      else if (/^\S/.test(line)) inPaths = false;
    }
  }
  return globs;
}

// 許可パスに当てはまるプロジェクトの規約(.claude/rules → .codex/rules の順、下位ディレクトリも含む。
// 同じ相対パスの規約は先を採る)。
// paths: の無い規約は常に適用。許可パスが中身の無いディレクトリなら照合できないので paths 付きも全部含める
export function selectRules(root, allow) {
  const candidates = [];
  let conservative = false;
  for (const a of allow) {
    const absolute = path.join(root, a);
    let isDir = a.endsWith("/");
    try { isDir = isDir || fs.statSync(absolute).isDirectory(); } catch { /* 未作成 */ }
    if (!isDir) { candidates.push(a); continue; }
    const listed = git(root, ["ls-files", "-co", "--exclude-standard", "-z", "--", a]).split("\0").filter(Boolean);
    if (listed.length === 0) conservative = true;
    candidates.push(...listed);
  }
  const seen = new Set();
  const rules = [];
  for (const dir of RULE_DIRS) {
    let names;
    try {
      names = fs.readdirSync(path.join(root, dir), { recursive: true }).map(String).filter((n) => n.endsWith(".md")).sort();
    } catch { continue; }
    for (const name of names) {
      if (seen.has(name)) continue;
      const file = `${dir}/${name}`;
      const text = fs.readFileSync(path.join(root, file), "utf8");
      const globs = ruleGlobs(text);
      const applies = globs.length === 0 || conservative
        || candidates.some((c) => globs.some((g) => path.matchesGlob(c, g)));
      if (!applies) continue;
      seen.add(name);
      rules.push({ file, text: text.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "").trim() });
    }
  }
  return { rules, conservative };
}

// worker に渡すプロンプト: 固定の契約 → 許可パス(runner が --allow から生成)→ 監督の packet → 規約の全文
//
// 文脈の取捨の意図: 「意図」の層(設計の背景・理由、兄弟タスク、将来計画)は worker に渡さない。与えるほど
// worker は構想を先回りして完成させようとし、範囲の外へ実装を広げる(2026-09-22 の T43 は設計の意図を読んだ上で
// 入力契約の変更を呼び出し元まで連鎖させた)。範囲外が要る判断は、全体を知る監督が worker の blocked を受けて行う。
// 一方「どう書くか」の層(プロジェクトの rules)は範囲を広げる方向に働かず、ゲートでは検査できない規約の遵守を
// 担うので、許可パスに当てはまるものを監督の判断に依らず runner が全文で付ける(worker が読み飛ばせないように)。
// packet には、そのステップが満たす契約(シグネチャ・形式)と完了の基準の該当項目だけを逐語で入れる
// (正は ~/.claude/templates/codex-worker.md)。
export function buildPrompt({ contract, allow, packet, rules }) {
  const parts = [contract.trim(), "## 変更してよいパス\n" + allow.map((a) => `- \`${a}\``).join("\n"), packet.trim()];
  if (rules.length > 0) {
    parts.push("## 適用される規約\n\n" + rules.map((r) => `### ${r.file}\n\n${r.text}`).join("\n\n"));
  }
  return parts.join("\n\n") + "\n";
}

// rollout(worker 用 CODEX_HOME の sessions)からピーク使用率と compaction 回数を読む
export function readRollout(file) {
  let peak = 0;
  let window = null;
  let compacted = 0;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (event.type === "compacted") compacted += 1;
    const info = event.type === "event_msg" && event.payload?.type === "token_count" ? event.payload.info : null;
    if (info?.last_token_usage && info.model_context_window) {
      window = info.model_context_window;
      peak = Math.max(peak, info.last_token_usage.total_tokens / info.model_context_window);
    }
  }
  return { peakRatio: Math.round(peak * 1000) / 1000, contextWindow: window, compacted };
}

export function findRollout(sessionsDir, threadId) {
  const suffix = `-${threadId}.jsonl`;
  const stack = [sessionsDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.name.endsWith(suffix)) return full;
    }
  }
  return null;
}

// モデルの系統名(luna / terra / sol など、model-routing.md の役割表の名前)を、`codex debug models` の一覧に
// ある最新の版の ID へ解決する。版番号を設定や文書に固定しないため(モデルは更新される)。見つからなければ null
export function resolveModelFamily(family, catalog) {
  const models = Array.isArray(catalog) ? catalog : catalog?.models ?? [];
  const version = (slug) => (slug.match(/\d+(?:\.\d+)*/)?.[0] ?? "0").split(".").map(Number);
  const newer = (a, b) => {
    const [x, y] = [version(a), version(b)];
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) > (y[i] ?? 0);
    }
    return false;
  };
  const suffix = `-${family.toLowerCase()}`;
  let best = null;
  for (const model of models) {
    const slug = String(model.slug ?? model.id ?? model.model ?? "");
    if (!slug.toLowerCase().endsWith(suffix)) continue;
    if (best === null || newer(slug, best)) best = slug;
  }
  return best;
}

// worker の最終応答の最低限の形の検査(--output-schema は Codex 側で課すが、欠落・途中終了に備える)
export function validateResult(result) {
  const keys = ["status", "changed_files", "tests_run", "criteria", "holes", "reference_errors", "notes"];
  if (!result || typeof result !== "object") return ["最終応答が JSON オブジェクトでない"];
  const errors = keys.filter((k) => !(k in result)).map((k) => `最終応答に ${k} が無い`);
  if (!["done", "blocked", "failed"].includes(result.status)) errors.push(`status が不正: ${result.status}`);
  return errors;
}
