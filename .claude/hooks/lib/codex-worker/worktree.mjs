// @ts-check

// worktree の突き合わせ・作成・状態・破棄・fast-forward 統合の Git 操作を持つ。
// 状態判定と Git の呼び出しをここに閉じ、ロック検査と作業記録の書き込みは呼び出し側に任せる。
// 置き場は ${XDG_STATE_HOME:-~/.local/state}/claude-codex-worker/worktrees/
// <ルート名>/<T>/、記録は tasks/<ルート名>/<T>/worktree.json に置く。

export { ensureWorktree, worktreeStatus } from "./worktree/state.mjs";
export { removeWorktree } from "./worktree/removal.mjs";
export {
  worktreeBranch,
  worktreeDir,
  worktreeRecordPath,
  readWorktreeRecord,
} from "./worktree/record.mjs";
export { integrateWorktree } from "./worktree/integration.mjs";
