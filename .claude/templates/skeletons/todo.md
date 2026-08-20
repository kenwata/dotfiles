<!--
規約(このコメントは消さない):
- 行数予算: 120 行。超過しそうな時は .claude/rules/growing-docs.md の手順で、完了タスクを
  古い順に .claude/archive/TODO.md へ一字一句そのまま移動する(要約禁止)。
- タスクID: プロジェクト内の通し番号(T1, T2, ...)。再利用・振り直し禁止。archive へ
  移動しても番号は欠番のまま維持する(git log --grep='T<n>' との対応を壊さないため)。
  新規採番は本ファイルと .claude/archive/TODO.md の最大番号 +1 から。
- タスク書式: - [ ] T<n>: <タスク名> — 完了条件: <検証可能な条件>
  (機械的に yes/no を出せない定性条件は [subjective] と明記する)
  計画単位の見出し「## <slug>(設計: docs/design/<slug>.md)」の下に置く。
- 状態は [ ] 未着手 / [x] 完了 の2値のみ。仕掛かり中の中断点はここに書かない
  (HANDOFF.md の領分)。
-->

# TODO

## §0 セッションプロトコル

- 開始時に読む: このファイルと `HANDOFF.md` の 2 つ
- タスク完了ごと: ①該当タスクを `[x]` に更新 ②git commit(要約に `T<n>` を含める。変更を生まないタスクは `git commit --allow-empty` で記録を残す)
- 終了時: `/follow-up` を実行する — 計画と成果の差分を検査・是正した上で、終了手順(チェックボックス更新・`HANDOFF.md` の全体上書き・`docs/decisions.md`・コミット)まで行う。手順の実体は `~/.claude/templates/BLUEPRINT.md` §6 が正

## {{slug}}(設計: docs/design/{{slug}}.md)

- [ ] T1: {{task_name}} — 完了条件: {{verifiable_condition}}
