# CLAUDE.md (Bedrock profile)

@../.claude/CLAUDE.md

## Bedrock 環境差分

この環境(`CLAUDE_CONFIG_DIR=~/.claude-bedrock`、Bedrock 経由)に Advisor tool は
存在しないが、主プロファイル側も `advisorModel` を外して advisor を使わない運用に
揃えた(2026-09-10)ため、上記 Delegation 節はそのまま適用する。残る差分は次の 2 点:

- **`agents/` の定義を使わず `general-purpose` 等を直接起動する場合は `model: "fable"` を
  明示する** — Agent tool は `model` 省略時に親セッションのモデルを継承するため、通常実行を
  fable より下位に置いているこの環境では、指定を省くとレビュー役が実行役より弱くなる。
  `agents/` の 5 定義はいずれも frontmatter に `model: fable` を持つので明示は要らない。
  実行モデルの役割分担は `../.claude/templates/model-routing.md`、レビュー役の固定モデルは
  各 agent 定義の frontmatter を正とする
- git の履歴・リモート変更を拒否する PreToolUse hook はこの環境でも有効である
  (`hooks/` は `../.claude/hooks/` の symlink、配線は当プロファイルの `settings.json`)
