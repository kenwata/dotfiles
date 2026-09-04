alias ll='ls -lah'
alias la='ls -A'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate --all'
alias ..='cd ..'

# ~/.claude/templates を .claude/ に展開（/initialize コマンド相当）
alias initialize='mkdir -p .claude && cp -Rn ~/.claude/templates/. .claude/'
