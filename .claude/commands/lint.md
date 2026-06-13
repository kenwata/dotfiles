---
description: LLM Wiki — 矛盾・孤立ページ・stale情報・リンク切れを監査する
argument-hint: (引数不要、対象を絞る場合は範囲を記述)
allowed-tools: Bash(date:*), Read, Write, Edit, Glob, Grep
---
今日の日付: !`date +%Y-%m-%d`

あなたはLLM Wikiのトピックディレクトリで作業している。Wikiの健全性を監査する（Lint操作）。$ARGUMENTS

確認項目:
1. `index.md` から主要ページに辿れるか / リンク切れがないか
2. index.md に未掲載のページ（孤立ページ）や、存在しないページへのリンクがないか
3. 同一概念の重複ページがないか
4. ページ間で矛盾・stale情報がないか
5. 出典が弱い断定が「未確認」と明記されているか
6. ファイル名が conventions.md の命名規則（raw: `YYYY-MM-DD_topic`、pages: 概念名の kebab-case）に従っているか

手順:
1. `../conventions.md`（無ければ `./conventions.md`）と `index.md` を読む。LLM Wikiのトピックでない場合は中止して伝える。
2. `pages/` と直下のファイルを確認し、上記項目を点検する。
3. 自明に修正できるもの（リンク切れ、index.md の記載漏れ）は修正する。判断が必要な問題は `open-questions.md` に追記する。
4. `log.md` の `## Entries` 以下に `[LINT YYYY-MM-DD] 監査範囲 → 発見した問題と対応` を追記する。
5. 発見した問題と対応を要約する。
