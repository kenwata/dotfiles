# dotfiles

[English](README.md) | [日本語](README-ja.md)

## インストール

```sh
git clone git@github.com:kenwata/dotfiles.git ~/dotfiles
cd ~/dotfiles
bash install.sh
```

対応OS: macOS (Apple Silicon / Intel)、Ubuntu / WSL。  
再実行可能 — 既存ファイルは `~/.dotfiles-backup/` にバックアップされます。

## モジュール

| カテゴリ | 内容 |
|---|---|
| パッケージマネージャ | Homebrew (macOS)、apt (Linux) |
| ランタイム管理 | mise、uv、pnpm |
| ランタイム | Python 3.12、Node.js LTS |
| シェル | zsh、Prezto |
| CLIツール | peco、ripgrep、fd、jq、fzf、tree、neovim、tmux、gh |
| その他 | Claude Code、agmsg、tpm |
