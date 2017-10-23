#!/bin/bash

# .vimrcと.gvimrcのシンボリックリンクを$HOME下に張る
ln -s ~/dotfiles/rcfiles/.vimrc ~/.vimrc
ln -s ~/dotfiles/rcfiles/.gvimrc ~/.gvimrc

# ~/.vim/に、分割しているvim設定ファイルのシンボリックリンクを張る
mkdir  ~/.vim
ln -s  ~/dotfiles/.vim/userautoload ~/.vim/

# fileTypeごとの設定(indentなど)
mkdir -p ~/.vim/after/ftplugin
cp ~/dotfiles/ftplugin/after ~/.vim/after/ftplugin/

# deinファイル
mkdir -p ~/.vim/dein/toml
ln -s ~/dotfiles/toml/linux/dein.toml ~/.vim/dein/toml/dein.toml
ln -s ~/dotfiles/toml/linux/dein_lazy.toml ~/.vim/dein/toml/dein_lazy.toml
