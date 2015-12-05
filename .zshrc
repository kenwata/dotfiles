# Vi ライクなキーバインドにする
bindkey -v

# 自動補完を有効にする
autoload -U compinit; compinit

# cdコマンドを省略
setopt auto_cd

# 入力したコマンドを、古い履歴から削除する
setopt hist_ignore_all_dups

# <Tab> でパス名の補完候補を表示した後、
# 続けて <Tab> を押すと候補からパス名を選択できる
# 候補選択は <Tab> か、vimの上下キーバインド
zstyle ':completion:default' menu select=1

