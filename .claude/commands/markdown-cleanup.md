---
description: markdown 整形・lint(.claude/hooks/lib/markdown-format/)をファイル全体に適用し、差分を確認してから単独コミットする。逐語引用の変更混入を防ぐため、hook 自体は編集行のみに限定してあり、全体規約保証はここで行う
allowed-tools: Read, Glob, Grep, AskUserQuestion, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git add:*), Bash(git commit:*), Bash(node:*)
---

対象ファイル(引数、または glob)に markdown 整形・lint の CLI をファイル全体モードで適用し、差分を確認してから単独コミットしてください。**この CLI は保存のたびに自動発火する hook 経由では編集行のみに限定されている**(未編集の逐語引用等への波及を防ぐため)。ファイル全体を規約に揃えたいときは、この手順で明示的に実行する。要点:

1. **対象の確定**: `$ARGUMENTS` が指す1個以上のファイル、または glob を .md ファイル一覧へ展開する。引数が無ければユーザーに対象(ファイル・glob・「リポジトリ全体」)を確認する。
2. **事前確認(git)**: 対象ファイルに `git status` で未コミットの変更が無いか確認する。ある場合は、整形差分がその変更に混ざる旨を警告し、先にコミット/退避するかこのまま進めるかをユーザーに確認する。
3. **全体整形の実行**: 各ファイルへ `node <このリポジトリの>.claude/hooks/lib/markdown-format/cli.mjs <file> <projectRoot>` を stdin 無しで実行する(stdin 無し = 全体モード。`.claude/rules/markdown.md` の `paths:` にマッチしないファイルは no-op)。`projectRoot` は対象ファイルが属するプロジェクトのルート。
4. **差分の確認**: `git diff` で整形差分を確認する。逐語引用(「」内の発言引用、`>` 引用ブロック、他文書からの転記)に変更が入っていないか特に確認し、該当箇所を見つけたら列挙してユーザーに revert 要否を確認する(整形は規約上正しくても、引用の逐語性を破る可能性があるため)。
5. **lint 結果の報告**: CLI の stderr(exit 2 で出力される)に lint 検出があれば、自動修正しないルールであることを明記して内容を報告する。
6. **単独コミット**: 整形差分のみであることを確認したうえで、cosmetic 変更として単独コミットすることをユーザーに提案する。承認されたら実行する(意味的な変更を混ぜない)。
