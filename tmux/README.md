# ビルドまで

必要なモジュールを入れる

#### mac

```zsh
brew install automake
brew install libevent
```

#### Ubuntu

```zsh
# build tool
sudo apt-get install automake

# dependency
sudo apt-get install libevent-dev libncurses5-dev

# clip board enable
sudo apt-get install xsel
```

## Git Clone する

```zsh
mkdir WorkSpace
cd WorkSpace
git clone https://github.com/tmux/tmux.git
cd tmux
# 最新のタグにチェックアウトしておく
# 確認
git tag
# チェックアウト
git checkout 2.6
```

##パッチを当てる

```zsh
# 下記サイトからバージョンに合わせてパッチを取得
# https://gist.github.com/z80oolong/e65baf0d590f62fab8f4f7c358cbcc34
# 今回は tmux 2.6
# これをしないと tmux -V のときに バージョンが master になる
patch -p1 < /path/to/tmux-2.6-fix.diff
sh ./autogen
./configure
make -j4
sudo make install
```

アンインストールする場合

```zsh
cd ~/WorkSpace/tmux
sudo make uninstall
```

# tmuxの設定

#### mac

```zsh
ln -s /to/path/dotfiles/tmux/mac.tmux.conf ~/.tmux.conf
ln -s /to/path/dotfiles/tmux/powerline ~/.config/
```

#### Ubunt

```zsh
ln -s /to/path/dotfiles/tmux/ubuntu.tmux.conf ~/.tmux.conf
ln -s /to/path/dotfiles/tmux/powerline ~/.config/
```

# git status

> https://github.com/jaspernbrouwer/powerline-gitstatus  

```zsh
pip install powerline-gitstatus
```

`~/.zshrc` に以下を記述  

```zshrc
. /to/path/python3/site-packages/powerline/bindings/zsh/powerline.zsh
```

powerline.zshの210〜213行目をコメントアウト  

`~/.config/powerline/themes/tmux/custom.json` の内容と `~/.config/powerline/themes/tmux/custom.json.org` を入れ替える  
