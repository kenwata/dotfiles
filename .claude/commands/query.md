---
description: LLM Wiki — index.mdから関連ページを特定し、問いに回答する
argument-hint: [質問・調査内容]
allowed-tools: Bash(date:*), Read, Write, Edit, Glob, Grep
---
今日の日付: !`date +%Y-%m-%d`

あなたはLLM Wikiのトピックディレクトリで作業している。次の問いに答える（Query操作）: $ARGUMENTS

手順:
1. `index.md` を読み、関連ページを特定する。LLM Wikiのトピックでない場合は中止して伝える。
2. 関連する `wiki/` を読み、回答を合成する。出典を示し、未確認情報は明示する。
3. 回答が新しい知識・再利用価値のある整理であれば `wiki/`（または `drafts/`）に保存し、`index.md` を更新する。単発の質問なら保存しなくてよい。
4. `log.md` の `## Entries` 以下に `[QUERY YYYY-MM-DD] クエリ概要 → 結果の保存先（無ければ「回答のみ」）` を追記する。
5. 回答を提示し、保存した場合は保存先を伝える。
