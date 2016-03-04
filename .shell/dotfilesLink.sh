#!/bin/bash

# .vimrcと.gvimrcのシンボリックリンクを$HOME下に張る
ln -s ~/dotfiles/.vimrc ~/.vimrc
ln -s ~/dotfiles/.gvim ~/.gvimrc

# 分割しているvim設定ファイルをコピー
mkdir  ~/.vim
cp -r ~/dotfiles/.vim/userautoload ~/.vim

# NeoBundle
# もう入っている場合はいらない
mkdir ~/.vim/bundle
git clone https://github.com/Shougo/neobundle.vim.git ~/.vim/bundle/neobundle.vim

# fileTypeごとの設定(indentなど)
mkdir ~/.vim/after/ftplugin
cp ~/dotfiles/.ftplugin/* ~/.vim/after/ftplugin/


