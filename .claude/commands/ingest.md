---
description: LLM Wiki — 新しいsourceをraw/に取り込み、関連ページを更新する
argument-hint: [取り込む素材の説明、URL、または raw/ のファイルパス]
allowed-tools: Bash(date:*), Read, Write, Edit, Glob, Grep
---
今日の日付: !`date +%Y-%m-%d`

あなたはLLM Wikiのトピックディレクトリで作業している。`$ARGUMENTS` を新しいsourceとして取り込む（Ingest操作）。

手順:
1. `../conventions.md`（無ければ `./conventions.md`）と `index.md` を読む。conventions.md と index.md が見つからずLLM Wikiのトピックでない場合は、その旨を伝えて中止する。
2. 素材を `raw/YYYY-MM-DD_topic.md`（今日の日付）として保存する。既に raw 内のファイルを指している場合は新規保存しない。
3. index.md を見て関連する既存ページを特定する。
4. 関連する `wiki/` を更新する（複数ページにまたがってよい）。出典が弱い情報は「未確認」と明記する。
5. 不明点・矛盾は `open-questions.md` に追記する。
6. ページを追加/大きく変更した場合は `index.md` の1行サマリーを更新する。
7. `log.md` の `## Entries` 以下に `[INGEST YYYY-MM-DD] 概要 → 更新したページ一覧` を追記する。既存エントリは編集しない。
8. 変更したファイルと要点を要約する。

ルール: `raw/` を削除しない。出典のない断定を避ける。小さくレビュー可能な変更にする。
