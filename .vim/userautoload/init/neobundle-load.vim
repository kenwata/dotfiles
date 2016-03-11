"**************************************************
"   プラグイン管理(NeoBundle)
"**************************************************
if has('vim_starting')
    if &compatible
        set nocompatible
    endif

    " Required:
    set runtimepath+=~/.vim/bundle/neobundle.vim/,~/dotfiles/ftplugin/after
endif

" Required:
call neobundle#begin(expand('~/.vim/bundle/'))

" Let NeoBundle manage NeoBundle
" Required:
NeoBundleFetch 'Shougo/neobundle.vim'

" My Bundle Here:
" ファイルオープンを便利にできる
NeoBundle 'Shougo/unite.vim'
" Unite.vimで最近使ったファイルを表示できるようにする
NeoBundle 'Shougo/neomru.vim'

" ファイルのtree表示
NeoBundle 'scrooloose/nerdtree'
" 設定
let NERDTreeShowHidden = 1

" VimからGitの操作ができる
NeoBundle 'tpope/vim-fugitive'
"" 設定
" grep検索の実行後にQuickFix Listを表示
autocmd QuickFixCmdPost *grep* cwindow
" ステータス行に現在のgitブランチを表示する
set statusline+=%{fugitive#statusline()}

" vimproc (vimの非同期処理のためのもの)
NeoBundle 'Shougo/vimproc', {
   \ 'build' : {
   \     'windows' : 'make -f make_mingw32.mak',
   \     'cygwin' : 'make -f make_cygwin.mak',
   \     'mac' : 'make -f make_mac.mak',
   \     'unix' : 'make -f make_unix.mak',
   \     },
   \ }

NeoBundle 'kana/vim-submode'

" vim-powerline (フォントをこの中から取得し、パッチを当てる)
NeoBundle 'Lokaltog/vim-powerline'

" ステータスラインのカスタマイズのためのプラグイン
NeoBundle 'itchyny/lightline.vim'
" lightline.vimと連携しているgitプラグイン
NeoBundle 'airblade/vim-gitgutter'
" powerlineがないと、lightlineで使う
" separatorとかのフォントが対応していないので
" 以下のプログインを入れる
NeoBundle 'alpaca-tc/alpaca_powertabline'
NeoBundle 'Lokaltog/powerline', { 'rtp' : 'powerline/bindings/vim'}
NeoBundle 'Lokaltog/powerline-fontpatcher'
" 上記のプラグインは、フォントにバッチを当てる必要が有る
" 手順は以下のとおり
" 1.fontforgeのインストール(次のcommandは、環境によって使い分け)
"   (mac)    $ brew install fontforge --withpython
"               or
"            $ port install fontforge
"   (linux)  $ yum install fontforge
"               or
"            $ apt-get install fontforge
" 2.バッチを当てる(macの場合はこんな感じ)
" sudo cp /System/Library/Fonts/Ricty-Regular.ttf $HOME/.font/
" fontforge -lang=py -script $HOME/.bundle/powerline-fontpatcher/scripts/powerline-
" fontpatcher $HOME/.font/Ricty-Regular.ttf

" Powerlineの設定
let g:Powerline_symbols = 'fancy'
" "文字化けするならこっち使う
" let g:Powerline_symbols = 'compatible'

set laststatus=2

" カラースキーマ(会社用)
NeoBundle 'nanotech/jellybeans.vim'
NeoBundle 'w0ng/vim-hybrid'

NeoBundle 'nathanaelkane/vim-indent-guides'
call neobundle#end()

" Required:
filetype plugin indent on

" vim起動時にインストールされていないプラグインがあれば
" 起動時にインストールする
NeoBundleCheck

