# Created by newuser for 5.4.2

# for anyenv
export PATH="$HOME/.anyenv/bin:$PATH"
eval "$(anyenv init - zsh)"

export VTE_CJK_WIDTH=1

# デフォルトで呼び出すエディタをNeoVimに変更
# brew edit などが nano editor にならないようにする
export EDITOR='vim'

# Powerline
export PATH="$PATH:$HOME/.local/bin"
#export POWERLINE_NO_SHELL_PROMPT="TRUE"
#. $HOME/.local/lib/python3.6/site-packages/powerline/bindings/zsh/powerline.zsh

# Home brew path
# export PATH=/usr/local/bin:$PATH
alias brew="PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin brew"

# nvim alias
alias nv="nvim"
#alias vim="nvim"

# update NEologd
alias update_neologd="
cd /tmp &&
git clone --depth 1 https://github.com/neologd/mecab-ipadic-neologd.git &&
cd mecab-ipadic-neologd &&
./bin/install-mecab-ipadic-neologd -n -y &&
cd ../ &&
rm -rf mecab-ipadic-neologd &&
cd "

# open PowerPoint from terminal
alias pp="open -b com.microsoft.PowerPoint"
# open Excel from terminal
alias wb="open -b com.microsoft.Excel"

# zprezto
source "${ZDOTDIR:-$HOME}/.zprezto/init.zsh"

# for peco
function peco-select-history() {
    local tac
    if which tac > /dev/null; then
        tac="tac"
    else
        tac="tail -r"
    fi
    BUFFER=$(\history -n 1 | \
        eval $tac | \
        peco --query "$LBUFFER")
    CURSOR=$#BUFFER
    zle clear-screen
}
zle -N peco-select-history
bindkey '^r' peco-select-history

# for vim fg
fancy-ctrl-z () {
    if [[ $BUFFER -eq 0 ]]; then
        BUFFER="fg"
        zle accept-line
    else
        zle push-input
        zle clear-screen
    fi
}
zle -N fancy-ctrl-z
bindkey '^Z' fancy-ctrl-z

# ##############
# # VCS_INFO(git)
# ##############
# autoload -Uz vcs_info
# setopt prompt_subst
# zstyle ':vcs_info:git:*' check-for-changes true
# zstyle ':vcs_info:git:*' stagedstr "%F{yellow}✔ "
# zstyle ':vcs_info:git:*' unstagedstr "%F{red}✚ "
# zstyle ':vcs_info:*' formats "%F{cyan}%c%u[%b]%f"
# zstyle ':vcs_info:*' actionformats '[%b|%a]'
# precmd () { vcs_info }
# RPROMPT=$RPROMPT'${vcs_info_msg_0_}'

# for tmux pwd
# ~/.anyenv/envs/pyenv/versions/3.6.3/lib/python3.6/site-packages/powerline/bindings/zsh/powerline.zsh
# comment out line 210-213
. ~/.anyenv/envs/pyenv/versions/3.6.3/lib/python3.6/site-packages/powerline/bindings/zsh/powerline.zsh

# turn off -> shell integration
# test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"
