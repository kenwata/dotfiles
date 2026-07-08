---
description: BLUEPRINT に従いプロジェクトを初期化(rules 選択コピー・CLAUDE.md 生成・handoff 雛形)
allowed-tools: Read, Glob, Grep, Write, Edit, AskUserQuestion, Bash(mkdir:*), Bash(cp:*), Bash(ls:*), Bash(basename:*), Bash(date:*)
disable-model-invocation: true
---

`~/.claude/templates/BLUEPRINT.md` を読み、その手順に従ってこのプロジェクトを初期化してください。要点:

1. **検出**(ユーザー入力なし): プロジェクト名(cwd の basename)、言語(BLUEPRINT §5 のマーカーファイルを Glob)、build/test/lint コマンド(package.json / Makefile / justfile / pyproject.toml / Cargo.toml 等から)、一行説明(README.md)、**目的の仮説**(README・既存コードから推測。新規空プロジェクトでは仮説なし)、既存の CLAUDE.md と .claude/ の状態。
2. **確認**: AskUserQuestion を **1 回だけ** 呼ぶ(最大 3 問)。①言語構成の確認(検出済みを事前選択、multiSelect)②目的とロール構成(BLUEPRINT §3 の出し方・§7 の選定原則に従う。仮説が立てば「目的+推奨ロールセット」を第一候補に、立たなければ「ロールなし/開発/調査系/文書系」を提示。デフォルト: ロールなし)③一行説明(README が無い/空の時のみ)。それ以外は聞かない。
3. **生成**(BLUEPRINT §4-§5、冪等性は §9 に厳密に従う):
   - `mkdir -p .claude/rules` → 常時ルール(coding-principles / testing / markdown)+ 選択言語のルールを `~/.claude/templates/rules/` から `cp -n`
   - CLAUDE.md: 無ければ `~/.claude/templates/skeletons/CLAUDE.project.md` の placeholder を検出値で埋めて Write(不明コマンドは「(未設定 — 判明したら記入)」、捏造禁止)。**既存なら上書きせず**、不足節のみ diff 提示して承認後に追記
   - `cp -n ~/.claude/templates/skeletons/handoff.md .claude/handoff.md` → `{{date}}` を今日の日付に Edit
   - ロール配置ありの場合のみ: 選定した各ロールについて `mkdir -p agents/<role>` → `~/.claude/templates/roles/<role>.md` を `agents/<role>/CLAUDE.md` へ `cp -n`。カタログに無いロールは BLUEPRINT §7 に従い新規起草して Write(汎用性があればユーザー確認のうえ `~/.claude/templates/roles/` へも保存を提案)
4. **報告**: ファイルごとに「作成 / 既存のためスキップ」の一覧表を出す。最後に一行:「`.claude/handoff.md` はコミット対象、`.claude/settings.local.json` は gitignore 推奨」。

再実行時は全スキップ報告のみで変更ゼロであること。
