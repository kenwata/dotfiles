#!/bin/bash

# deinディレクトリを作成
mkdir -p ~/.vim/dein
# ホームディレクトリに_vimrcのシンボリックリンクを張る
ln -s ~/dotfiles/_vimrc ~/
# .vimディレクトリにuserautoload(プラグイン設定ファイル群)のシンボリックリンクを張る
ln -s ~/dotfiles/.vim/userautoload ~/.vim/
# deinでインストールするプラグインについてのtomlにシンボリックリンクを張る
ln -s ~/dotfiles/toml/win/toml ~/.vim/dein
# ftpluginファイルのシンボリックリンクを張る
ln -s ~/dotfiles/ftplugin/after ~/.vim/
# 一度vimを起動し、vimprocをmakeしたファイルを移動する
