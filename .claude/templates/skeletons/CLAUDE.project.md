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
- 引き継ぎ: `HANDOFF.md`(ルート直下) — タスク状態・次の一手・要確認のみ。**毎セッション終了時に全体上書き**(追記しない)。個人的な学びは auto memory に任せる
- 判断ログ: `docs/decisions.md` — 仕様解釈・設計からの逸脱・ユーザー決定を1行追記(セッション終了時、該当があれば)
- 過去ログ: `.claude/archive/` — TODO・changelog 等から溢れた分の逐語アーカイブ(必要時のみ読む)
{{roles_pointer}}
{{docs_pointer}}

## セッション運用

- 開始時: `HANDOFF.md` を読み、「次セッションの最初の一手」から着手する(`TODO.md` があればそれも読む。それ以外は読まない)
- 複数ターンかかるタスク: `/goal <検証可能な完了条件>, or stop after 20 turns` で完了まで駆動する
- plan mode 承認後: 実装に着手する**前に**、同一セッション内で `/breakdown` を実行し `docs/design/` + `TODO.md`(タスクID付き)へ着地させる(ユーザーが打たなくても自分で起動する。検討の行間が生きているのは承認直後だけ)
- 判断に迷ったら推測で進めず、`HANDOFF.md` の「要確認」に記録して依存しない次のタスクへ進む
- タスク完了ごとに git commit(1タスク=1コミット)。メッセージ: `<prefix>: 要約`(TODO 管理下なら要約に T<n> を含める)+ 本文に「タスク: 依頼内容」「対応: どう解決したか」
- 過去の経緯調査: `git log --oneline -- <path>` → `git log --grep=<語>`(タスクIDは境界付き `-E --grep='T7([^0-9]|$)'` 形式で桁違いIDへの誤マッチを防ぐ)→ `git show <sha>` の順で絞り込む。`git log` の全件読み込みはしない
- 終了時: `HANDOFF.md` を**全体上書き**する(追記しない)。仕様解釈・設計からの逸脱・ユーザー決定があれば `docs/decisions.md` に1行追記する
- 修正指摘を受けたら: 直して終わりにしない。同種ミスが再発しうるか判定し、しうるなら規約化してから完了を報告する
  - 特定ファイルの書式(TODO・changelog 等) → そのファイル冒頭のコメント規約に追記
  - プロジェクト全体のコード規約 → `.claude/rules/`(paths: 付き)
  - 全プロジェクト共通の規約 → `~/.claude/templates/rules/` への還元を提案
  - 個人の好み・環境固有 → auto memory
