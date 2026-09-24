alias ll='ls -lah'
alias la='ls -A'
alias gs='git status'
alias gd='git diff'
alias gl='git log --oneline --graph --decorate --all'
alias ..='cd ..'

# ~/.claude/templates を .claude/ に展開（/initialize コマンド相当）
alias initialize='mkdir -p .claude && cp -Rn ~/.claude/templates/. .claude/'

# /execute-task の連続実行ループ。herdr のペインの端末で、プロジェクトのディレクトリから打つ。
# 引数なしで HANDOFF.md の次の一手から /follow-up の 1 区間を、`task-loop T12..T16` で範囲を回す。送る先のペインは自動で探す
alias task-loop='node ~/.claude/hooks/lib/task-loop/cli.mjs run'
