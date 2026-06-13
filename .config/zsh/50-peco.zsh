# peco が存在しない場合はスキップ
(( $+commands[peco] )) || return

# cdr: 最近使ったディレクトリ
autoload -Uz chpwd_recent_dirs cdr add-zsh-hook
add-zsh-hook chpwd chpwd_recent_dirs
zstyle ':chpwd:*' recent-dirs-max 500
zstyle ':chpwd:*' recent-dirs-default yes
zstyle ':completion:*' recent-dirs-insert both

# ctrl+r: コマンド履歴をpecoで検索（重複除去・新しい順）
function peco-select-history() {
  # tac (Linux/GNU) / tail -r (macOS/BSD) を配列で保持（zshは単語分割しないため配列必須）
  local -a rev
  if (( $+commands[tac] )); then
    rev=(tac)
  else
    rev=(tail -r)
  fi
  local selected
  selected=$(fc -l -n 1 | awk '!seen[$0]++' | "${rev[@]}" | peco --query "$LBUFFER")
  if [[ -n "$selected" ]]; then
    BUFFER="$selected"
    CURSOR=$#BUFFER
  fi
  zle clear-screen
}
zle -N peco-select-history
bindkey '^r' peco-select-history

# ctrl+]: cdrで最近のディレクトリをpecoで選択
function peco-cdr() {
  local selected_dir
  # awk の $2 はスペースで分割されるためスペース含みパスが途切れる → sed で番号のみ除去
  selected_dir=$(cdr -l | sed 's/^[0-9][0-9]*[[:space:]]*//' | peco)
  if [[ -n "$selected_dir" ]]; then
    BUFFER="cd ${selected_dir}"
    zle accept-line
  fi
  zle clear-screen
}
zle -N peco-cdr
bindkey '^]' peco-cdr
