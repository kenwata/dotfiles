# {{project_name}}

{{one_line_description}}

## コマンド

| 操作 | コマンド |
| ---- | -------- |
| build | {{build_cmd}} |
| test | {{test_cmd}} |
| lint | {{lint_cmd}} |

## ポインタ(規約の中身はここに書かない)

- コーディング規約: `.claude/rules/` — path-scoped で該当ファイル操作時に自動適用される。規約の追加・編集もそこで行う
- 引き継ぎ: `.claude/handoff.md` — タスク状態・TODO のみ。個人的な学びは auto memory に任せる
- 過去ログ: `.claude/archive/` — handoff 等から溢れた分の逐語アーカイブ(必要時のみ読む)
{{roles_pointer}}
{{docs_pointer}}

## セッション運用

- 開始時: `.claude/handoff.md` を読み、「次の一手」から着手する
- 複数ターンかかるタスク: `/goal <検証可能な完了条件>, or stop after 20 turns` で完了まで駆動する
- 終了時: `.claude/handoff.md` を更新する — 完了項目は「完了」欄へ移し、前回の完了欄は削除する
- 修正指摘を受けたら: 直して終わりにしない。同種ミスが再発しうるか判定し、しうるなら規約化してから完了を報告する
  - 特定ファイルの書式(TODO・changelog 等) → そのファイル冒頭のコメント規約に追記
  - プロジェクト全体のコード規約 → `.claude/rules/`(paths: 付き)
  - 全プロジェクト共通の規約 → `~/.claude/templates/rules/` への還元を提案
  - 個人の好み・環境固有 → auto memory
