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
{{roles_pointer}}
{{docs_pointer}}

## セッション運用

- 開始時: `.claude/handoff.md` を読み、「次の一手」から着手する
- 複数ターンかかるタスク: `/goal <検証可能な完了条件>, or stop after 20 turns` で完了まで駆動する
- 終了時: `.claude/handoff.md` を更新する — 完了項目は「完了」欄へ移し、前回の完了欄は削除する
