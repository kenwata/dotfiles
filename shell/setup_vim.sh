#!/bin/bash

# for MacOSX, Linux(Ubuntu)

SCRIPT_DIR=$(cd $(dirname $0); pwd)

# Vim setup
mkdir -p $HOME/.vim
ln -s $SCRIPT_DIR/../rcfiles/.vimrc $HOME/
ln -s $SCRIPT_DIR/../.vim/userautoload $HOME/.vim/
ln -s $SCRIPT_DIR/../.vim/template $HOME/.vim/
ln -s $SCRIPT_DIR/../ftplugin/after $HOME/.vim/

# NeoVim setup
mkdir -p $HOME/.config/nvim
ln -s $SCRIPT_DIR/../rcfiles/init.vim $HOME/.config/nvim/
ln -s $SCRIPT_DIR/../.vim/userautoload $HOME/.config/nvim/
ln -s $SCRIPT_DIR/../.vim/template $HOME/.config/nvim/
ln -s $SCRIPT_DIR/../ftplugin/after $HOME/.config/nvim/

# common
mkdir -p $HOME/.vim/dein
ln -s $SCRIPT_DIR/../toml/linux $HOME/.vim/dein/toml
