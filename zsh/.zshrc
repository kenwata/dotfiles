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
# TODO
#. "$(pyenv root)/versions/$(cat $(pyenv root)/version | tail -n 1)/lib/$(echo -n $(ls $(pyenv root)/versions/$(cat $(pyenv root)/version | tail -n 1)/lib/ | grep "^python3\..$"))/site-packages/powerline/bindings/zsh/powerline.zsh"

# turn off -> shell integration
# test -e "${HOME}/.iterm2_shell_integration.zsh" && source "${HOME}/.iterm2_shell_integration.zsh"

alias pyenv='CONFIGURE_OPTS="--with-openssl=$(brew --prefix openssl@1.1)" pyenv'

# for matplotlib
export LDFLAGS="-L/usr/local/opt/tcl-tk/lib"
export CPPFLAGS="-I/usr/local/opt/tcl-tk/include"

# # docker command completion
# mkdir -p ~/.zsh/completion
# curl -o ~/.zsh/completion/_docker https://raw.githubusercontent.com/docker/cli/master/contrib/completion/zsh/_docker
# curl -o ~/.zsh/completion/_docker https://raw.githubusercontent.com/docker/cli/master/contrib/completion/zsh/_docker
export fpath=(~/.zsh/completion $fpath)
autoload -Uz compinit && compinit -i

# # >>> conda initialize >>>
# # !! Contents within this block are managed by 'conda init' !!
# __conda_setup="$('/Users/watanabekenta/.anyenv/envs/pyenv/versions/miniconda3-4.7.12/bin/conda' 'shell.zsh' 'hook' 2> /dev/null)"
# if [ $? -eq 0 ]; then
#     eval "$__conda_setup"
# else
#     if [ -f "/Users/watanabekenta/.anyenv/envs/pyenv/versions/miniconda3-4.7.12/etc/profile.d/conda.sh" ]; then
#         . "/Users/watanabekenta/.anyenv/envs/pyenv/versions/miniconda3-4.7.12/etc/profile.d/conda.sh"
#     else
#         export PATH="/Users/watanabekenta/.anyenv/envs/pyenv/versions/miniconda3-4.7.12/bin:$PATH"
#     fi
# fi
# unset __conda_setup
# # <<< conda initialize <<<

