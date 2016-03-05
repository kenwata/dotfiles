#!/bin/bash

# .vimrcと.gvimrcのシンボリックリンクを$HOME下に張る
ln -s ~/dotfiles/.vimrc ~/.vimrc
ln -s ~/dotfiles/.gvim ~/.gvimrc

# ~/.vim/に、分割しているvim設定ファイルのシンボリックリンクを張る
mkdir  ~/.vim
ln -s  ~/dotfiles/.vim/userautoload ~/.vim/

# NeoBundle
# もう入っている場合はいらない
mkdir ~/.vim/bundle
git clone https://github.com/Shougo/neobundle.vim.git ~/.vim/bundle/neobundle.vim

# fileTypeごとの設定(indentなど)
mkdir -p ~/.vim/after/ftplugin
cp ~/dotfiles/.ftplugin/* ~/.vim/after/ftplugin/


