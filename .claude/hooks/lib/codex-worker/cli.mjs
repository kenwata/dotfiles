#!/usr/bin/env node
// Claude Code の /execute-task が、実装ステップ 1 つを Codex worker(codex exec)へ委譲するための runner。
// 監督の手順の正は ~/.claude/templates/codex-worker.md。
//
// 呼び出し規約:
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs plan --root <プロジェクトルート> --task T<n> --file <plan.md>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs show --root <プロジェクトルート> --task T<n> [--json]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs note --root <プロジェクトルート> --task T<n>
//        --kind <fact|decision|rejected|intent|step|handoff|resume> --text <本文 1 行>
//        [--step <番号>] [--from <番号>(resume)] [--changed auto | --changed <パス,パス>]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs resume --root <プロジェクトルート> --task T<n>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs run --root <プロジェクトルート> --task T<n> --step <番号>
//        --packet <packet.md> --allow <パス> [--allow <パス> ...(既定で 3 件まで)]
//        [--workspace <リポジトリ>] [--worktree [--parallel [--max-parallel <件数>]]]
//        [--model-family <luna|terra|sol ...> | --model <モデル ID>] [--timeout <秒>]
//        [--max-packet <バイト>] [--max-allow <件数>] [--peak-threshold <0〜1>]
//        [--max-file-lines <n>]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs integrate --root <root> --task T<n>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs integrate-step --root <root> --task T<n>
//        --step <番号>
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs worktree --root <root> --task T<n> [--json]
//        [--remove [--force]]
//   実行中ロックは作業場所を含む git の最上位(git.mjs の lockRoot)の単位
//   --worktree の run では worktree の最上位になり、ロックは worktree ごとに分かれる
//   check-task-scope.mjs が止める Claude 側の編集も worktree の中だけになる
//   commands/ にサブコマンド、worktree/ に worktree の git 操作を置く
//   --parallel は依存の無いステップを同時に走らせる(--worktree と一緒に使う)。ステップ専用の worktree
//   (worktree/steps.mjs。T の worktree のブランチの先端から切る)で worker を動かし、同じ T の並列ステップどうしだけ
//   同時に起動できる。同時数の上限(既定 3、--max-parallel)と、走っている兄弟と許可パスが重なる起動は拒否する
//   (parallel.mjs)。受け入れたステップは監督がその worktree でコミットし、integrate-step で T の worktree へ取り込む。
//   T の integrate は、取り込んでいないステップの worktree が残っている間は拒否する
//   --workspace は worker が書くリポジトリ(既定は --root)。T の対象がプロジェクトの外の
//   リポジトリ(dotfiles など)にある時に使う。--root は帳簿(TODO.md・ステップ計画・作業記録・
//   状態行)の場所のまま、worker の起動(codex exec -C)・snapshot・ゲート・restore・ロック・verify は
//   作業場所で行う。--allow は作業場所からの相対で書き、T の対象の `~/…` と絶対パスは作業場所の中へ
//   読み替えて照合する。規約は作業場所 → --root の順に選ぶ
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs restore --run <run ディレクトリ> [--keep <残すパス> ...]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs verify --run <run ディレクトリ> [--timeout <1 本あたりの秒>]
//   node ~/.claude/hooks/lib/codex-worker/cli.mjs size-check --run <run ディレクトリ> [--max-file-lines <n>]
//   worker 用 CODEX_HOME は環境変数 CODEX_WORKER_HOME(既定 ~/.codex-worker、.codex/install.sh が作る)。
//   モデルは既定で系統 luna(model-routing.md の通常実装)を、`codex debug models` の一覧の最新の版へ解決する。
//   版番号をどこにも固定しないため。--model は解決を飛ばして ID を直接渡す(一覧に無いモデルを試す時だけ)。
//   実行中の状態行(コマンド・編集したファイル・進捗・トークン・判定)は stderr と
//   ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/status/<ルートのパスの記号を - にした名前>.log に出す
//   (人が追うためのもの。report ではない。プロジェクトごとに分けるのは、同じリポジトリでは worker が同時に 1 つなので
//   混ざらないため。--parallel の兄弟ステップは同じログに書くが、行の前置きのステップ番号で分けて読める)。
//   run の記録は ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/runs/ に置く(worker の sandbox は
//   TMPDIR と /tmp に書けるので、restore の元になる退避コピーをそこに置かない)。7 日より古い記録は run の度に消す。
//
// run の流れ: 起動前検査(許可パス ⊆ T の対象、件数の上限、状態文書を含まない、packet の大きさ、worker 環境、
// 実行中の別 worker、sandbox の疎通 = loopback は通り外部は拒否、モデルの解決)→ snapshot → ロック
// (check-task-scope.mjs が Claude 側の編集を止める)→ codex exec(独立したプロセスグループ。タイムアウトとシグナルで
// グループごと止める。UV_CACHE_DIR は TMPDIR の下の run 専用のディレクトリで、終わったら消す)→ ロック解除 →
// rollout からピーク使用率と compaction → ゲート → 必要なら restore(上書き前に現在の内容を退避)→ report。
//
// 出力規約: どの経路でも JSON を 1 つ stdout に出す(run は <run ディレクトリ>/report.json にも保存)。
//   exit 0 = accepted(機構上の失敗なし。worker の status が blocked / failed でも監督の判断材料として有効)
//   exit 1 = 不採用(run)・統合不可(integrate)。run の reasons に理由。
//            restore.restored は snapshot 時点へ戻したパス、restore.unrestorable は
//            自動では戻せなかったパス、restore.backups は上書き前の内容の退避先)
//   exit 2 = 起動前に拒否、または引数・記録の誤り(worker を起動していない / 何も変更していない)
// restore は、監督が accepted の結果を採らないと決めた時に、そのステップの許可パスの中の変更を snapshot 時点へ
// 戻す(許可パスの外は触らない)。--keep を渡すと、そのパスの中の変更は残す。
// plan は、タスクのステップ計画(「- s<番号>: <目的>」の箇条書き)を
// ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/tasks/<ルートのパスの記号を - にした名前>/T<n>/plan.md に登録する。
// 登録し直すと前の計画は plan-<時刻>.md に残る。run は計画に無いステップを起動せず、packet を同じ場所の
// s<番号>.packet.md(最新)と
// s<番号>-<run_id>.packet.md(run ごと。上書きしない)にも写す。
// show は計画の各ステップの最新の run の状態と verify の結果を
// 人向けの表で出す。
// verify は、run の packet の「## 検証」節のコマンドを worker と同じ sandbox(`codex sandbox`、worker 用 CODEX_HOME の
// 設定)の中で 1 本ずつ別々に打ち、コマンドごとの終了コードを JSON で stdout と <run ディレクトリ>/verify.json に出す。
// worker が書いたコードを、API キーとネットワークのある sandbox の外で走らせないため。UV_CACHE_DIR は verify 専用。
//   exit 0 = 全部 0、exit 1 = 0 でないものがある、exit 2 = 記録の誤り・worker の実行中・sandbox の疎通の不一致
//   (何も打っていない)
// 作業記録(worklog.md、書式の正は worklog.mjs): plan / run / verify / integrate は結果を
// タスクの置き場の worklog.md にも 1 行ずつ追記する(run の記録は 7 日で消えるが、worklog は消えない)。
// note は監督(Codex ホストでは本人)がステップの境目の結論を追記する。integrate は成功時に
// ブランチと本体へ進めたコミット数を記録する。resume は同じ T の再開の照合を JSON で返す:
// 計画の各ステップの状態、最後の handoff、
// 作業記録で説明できない未コミットの変更(unexplained_dirty。空でなければ再開せず止まる)。show は runs/ が
// 消えたステップを worklog から埋める。--json で同じ内容を JSON で出す。

import { parseArgs } from "node:util";
import { emit } from "./output.mjs";
import { restoreRun, verifyRun } from "./commands/run-review.mjs";
import { sizeCheckCommand } from "./commands/size-check.mjs";
import { run } from "./commands/run.mjs";
import { integrateStepTask, integrateTask, worktreeTask } from "./commands/task-worktree.mjs";
import { noteTask, registerPlan, resumeTask, showTask } from "./commands/task-ledger.mjs";

let parsed;
try {
  parsed = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string" }, task: { type: "string" }, step: { type: "string" }, packet: { type: "string" },
      allow: { type: "string", multiple: true }, model: { type: "string" }, "model-family": { type: "string" },
      timeout: { type: "string" }, "max-packet": { type: "string" }, "max-allow": { type: "string" },
      "peak-threshold": { type: "string" }, run: { type: "string" }, keep: { type: "string", multiple: true },
      file: { type: "string" }, kind: { type: "string" }, text: { type: "string" }, from: { type: "string" },
      changed: { type: "string" }, json: { type: "boolean" }, workspace: { type: "string" },
      worktree: { type: "boolean" }, parallel: { type: "boolean" },
      "max-parallel": { type: "string" },
      "max-file-lines": { type: "string" },
      remove: { type: "boolean" }, force: { type: "boolean" },
    },
  });
} catch (error) {
  emit({ errors: [error.message] }, null, 2);
}
if (parsed) {
  const command = parsed.positionals[0];
  if (command === "run") await run(parsed.values);
  else if (command === "restore") restoreRun(parsed.values);
  else if (command === "verify") await verifyRun(parsed.values);
  else if (command === "size-check") sizeCheckCommand(parsed.values);
  else if (command === "plan") registerPlan(parsed.values);
  else if (command === "show") showTask(parsed.values);
  else if (command === "note") noteTask(parsed.values);
  else if (command === "integrate") integrateTask(parsed.values);
  else if (command === "integrate-step") integrateStepTask(parsed.values);
  else if (command === "worktree") worktreeTask(parsed.values);
  else if (command === "resume") resumeTask(parsed.values);
  else emit({
    errors: [`usage: cli.mjs ${[
      "plan ...",
      "run ...",
      "integrate --root <root> --task T<n>",
      "integrate-step --root <root> --task T<n> --step <番号>",
      "worktree --root <root> --task T<n> [--json] [--remove [--force]]",
      "show ... [--json]",
      "note ...",
      "resume ...",
      "restore --run <dir>",
      "verify --run <dir>",
      "size-check --run <dir> [--max-file-lines <n>]",
    ].join(" | ")}`],
  }, null, 2);
}
