# herdr が存在しない場合はスキップ
(( $+commands[herdr] )) || return

eval "$(herdr completion zsh)"
