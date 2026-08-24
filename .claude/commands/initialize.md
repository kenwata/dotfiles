---
description: BLUEPRINT に従いプロジェクトを初期化(rules 選択コピー・CLAUDE.md 生成・HANDOFF/decisions 雛形)
allowed-tools: Read, Glob, Grep, Write, Edit, AskUserQuestion, Bash(mkdir:*), Bash(cp:*), Bash(ls:*), Bash(basename:*), Bash(date:*), Bash(git init:*), Bash(git rev-parse:*), Bash(git status:*), Bash(git add:*), Bash(git commit:*), Bash(git log:*), Bash(git ls-files:*)
disable-model-invocation: true
---

`~/.claude/templates/BLUEPRINT.md` を読み、その手順に従ってこのプロジェクトを初期化してください。要点:

1. **検出**(ユーザー入力なし): プロジェクト名(cwd の basename)、言語(BLUEPRINT §5 のマーカーファイルを Glob)、build/test/lint コマンド(package.json / Makefile / justfile / pyproject.toml / Cargo.toml 等から)、一行説明(README.md)、**目的の仮説**(README・既存コードから推測。新規空プロジェクトでは仮説なし)、既存の CLAUDE.md・`.claude/`・`HANDOFF.md`・旧方式 `.claude/handoff.md` の有無と内容、**既存のディレクトリ構造**(`git ls-files` で追跡対象ディレクトリを把握)、**git repo の有無**(`git rev-parse --is-inside-work-tree`)。
2. **確認**: AskUserQuestion を **1 回だけ** 呼ぶ(最大 3 問)。①言語構成の確認(検出済みを事前選択、multiSelect)②目的とロール構成(BLUEPRINT §3 の出し方・§7 の選定原則に従う。仮説が立てば「目的+推奨ロールセット」を第一候補に、立たなければ「ロールなし/開発/調査系/文書系」を提示。デフォルト: ロールなし)③一行説明(README が無い/空の時のみ)。旧方式 `.claude/handoff.md` を検出した場合は BLUEPRINT §9 の移行手順に従い別途確認する。それ以外は聞かない。
3. **生成**(BLUEPRINT §4-§5、冪等性は §9 に厳密に従う):
   - git repo でなければ `git init`(既存 repo ではスキップ)
   - `mkdir -p .claude/rules` → 常時ルール(coding-principles / testing / markdown / growing-docs)+ 選択言語のルールを `~/.claude/templates/rules/` から `cp -n`
   - CLAUDE.md: 無ければ `~/.claude/templates/skeletons/CLAUDE.project.md` の placeholder を検出値で埋めて Write(不明コマンドは「(未設定 — 判明したら記入)」、捏造禁止)。**既存なら上書きせず**、不足節のみ diff 提示して承認後に追記
   - `cp -n ~/.claude/templates/skeletons/handoff.md HANDOFF.md`(プロジェクトルート直下)→ `{{date}}` を今日の日付に Edit
   - `mkdir -p docs` → `cp -n ~/.claude/templates/skeletons/decisions.md docs/decisions.md`
   - `docs/architecture.md`: 無ければ `~/.claude/templates/skeletons/architecture.md` の placeholder を埋めて Write。新規プロジェクトなら検出言語の標準レイアウト(規約の実体は `.claude/rules/coding-principles.md` §13)から初期形を書く。既存プロジェクトなら**実ツリーから起こす**(検出したディレクトリ構造を正として記録する。現状が規約に反していても無断で移動せず、「未決」節に列挙する)。既存なら上書きせず、不足があれば diff 提示のうえ承認後に追記
   - 旧方式 `.claude/handoff.md` を検出していた場合: BLUEPRINT §9 の移行手順(承認後に内容を `HANDOFF.md` へ整形移行→旧ファイル削除→`growing-docs.md` のパス確認)を実施
   - ロール配置ありの場合のみ: 選定した各ロールについて `mkdir -p agents/<role>` → `~/.claude/templates/roles/<role>.md` を `agents/<role>/CLAUDE.md` へ `cp -n`。カタログに無いロールは BLUEPRINT §7 に従い新規起草して Write(汎用性があればユーザー確認のうえ `~/.claude/templates/roles/` へも保存を提案)
4. **検証**: BLUEPRINT §11 の生成後検証(ポインタ実在確認・rules の `paths:` frontmatter 一致確認・循環参照の不在確認・git repo であることの確認・`docs/architecture.md` のツリー一致確認)を実施する。Glob/Grep/Read/`git ls-files` で確認し、不一致があれば報告前に修正する。
5. **初期コミット**(BLUEPRINT §6 の書式・§9 に従う): 新規に `git init` した場合は、生成ファイルのみを個別パス指定で `git add` し自動コミット。既存 repo の場合は生成ファイルをコミットしてよいか確認し、拒否されたらスキップとして報告。メッセージ例:

   ```
   chore: Claude Code プロジェクト初期化

   タスク: /initialize によるプロジェクト初期化
   対応: rules / CLAUDE.md / HANDOFF.md / docs/decisions.md / docs/architecture.md を BLUEPRINT に従い生成
   ```

6. **報告**: ファイルごとに「作成 / 既存のためスキップ」の一覧表を出す(git init・初期コミットの実施有無も含める)。最後に一行:「`HANDOFF.md`・`docs/decisions.md`・`docs/architecture.md` はコミット対象、`.claude/settings.local.json` は gitignore 推奨」。

再実行時は全スキップ報告のみで変更ゼロであること。macOS の `cp -n` はスキップ時に exit 1 を返すが失敗ではない(BLUEPRINT §9)。

本コマンドの意図・経緯・変更理由は dotfiles の履歴(`2026-07-08 templates: BLUEPRINTベースの初期化フローに再設計`)と `~/.claude/templates/BLUEPRINT.md` 本文の失敗事例に残っている。
