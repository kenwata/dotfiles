# dotfiles

[English](README.md) | [日本語](README-ja.md)

## Install

```sh
git clone git@github.com:kenwata/dotfiles.git ~/dotfiles
cd ~/dotfiles
bash install.sh
```

Supports macOS (Apple Silicon / Intel) and Ubuntu / WSL.  
Re-runnable — existing files are backed up to `~/.dotfiles-backup/`.

## Modules

| Category | Modules |
|---|---|
| Package manager | Homebrew (macOS), apt (Linux) |
| Runtime manager | mise, uv, pnpm |
| Runtimes | Python 3.12, Node.js LTS |
| Shell | zsh, Prezto |
| CLI tools | peco, ripgrep, fd, jq, fzf, tree, neovim, tmux, gh |
| Other | Claude Code, agmsg, tpm |
