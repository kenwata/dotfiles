"**************************************************
" プラグイン管理(NeoBundle)
"**************************************************
if has('vim_starting')
    if &compatible
        set nocompatible
    endif

    " Required:
    set runtimepath+=~/.vim/bundle/neobundle.vim/
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
" 候補絞り込み検索ファイラ
NeoBundle "ctrlpvim/ctrlp.vim"

" ファイルのtree表示
NeoBundle 'scrooloose/nerdtree'

" VimからGitの操作ができる
NeoBundle 'tpope/vim-fugitive'
"" 設定
" grep検索の実行後にQuickFix Listを表示
" autocmd QuickFixCmdPost *grep* cwindow

" vimproc (vimの非同期処理のためのもの)
NeoBundle 'Shougo/vimproc', {
    \ 'build' : {
    \     'windows' : 'make -f make_mingw32.mak',
    \     'cygwin' : 'make -f make_cygwin.mak',
    \     'mac' : 'make -f make_mac.mak',
    \     'unix' : 'make -f make_unix.mak',
    \     },
    \ }

" カラーテーマ
NeoBundle 'altercation/vim-colors-solarized'
NeoBundle 'w0ng/vim-hybrid'

" 補完系
NeoBundle 'Shougo/neocomplcache'
NeoBundle 'Shougo/neosnippet'
NeoBundle 'Shougo/neosnippet-snippets'

" 画面を分割してプログラムを実行などする時
NeoBundle 'thinca/vim-quickrun'

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
"let g:Powerline_symbols = 'fancy'
" "文字化けするならこっち使う
" let g:Powerline_symbols = 'compatible'

" インデントを表示
NeoBundle 'nathanaelkane/vim-indent-guides'

" テキストオブジェクトで置換
NeoBundle 'kana/vim-operator-replace.git'
NeoBundle 'kana/vim-operator-user.git'
NeoBundle 'kana/vim-textobj-user'

" なんだろう？
NeoBundle 'rhysd/vim-operator-surround'

" 連続入力補助
NeoBundle 'kana/vim-submode'

""""""""""""""""""""""""""""""""""""""""
" Python Plugins
""""""""""""""""""""""""""""""""""""""""
" IDEのようなオムニ補完をしてくれる
NeoBundle 'davidhalter/jedi-vim'
" 静的検査やスタイルチェックをかけてくれる
NeoBundle 'andviro/flake8-vim'
" vim標準のインデントは挙動が不審で、普通に書いていると
" pep8に違反してしまう為、このpluginでインデント補助
NeoBundle 'hynek/vim-python-pep8-indent'
" vim内のPython環境と、virtualenvを連動してくれる
NeoBundle 'jmcantrell/vim-virtualenv'
" 編集している関数の内、ローカル変数をハイライトしてくれる
NeoBundle 'hachibeeDI/python_hl_lvar.vim'
" インデント単位でテキストオブジェクトを使えるようになる
NeoBundle 'kana/vim-textobj-indent'
" Pythonの関数やクラスをテキストオブジェクトとして扱えるようになる
NeoBundle 'bps/vim-textobj-python'
" 使わなかったらけす。smartinputの拡張？
NeoBundle 'kana/vim-smartinput'

""""""""""""""""""""""""""""""""""""""""
" javascript Plugins
""""""""""""""""""""""""""""""""""""""""
NeoBundle 'moll/vim-node'
NeoBundle 'mattn/jscomplete-vim'
NeoBundle 'myhere/vim-nodejs-complete'

NeoBundleLazy 'jelera/vim-javascript-syntax', {'autoload':{'filetypes':['javascript']}}

NeoBundle 'scrooloose/syntastic'

" ドキュメントジェネレータ
NeoBundle 'heavenshell/vim-jsdoc'

NeoBundle 'guileen/vim-node-dict'

""""""""""""""""""""""""""""""""""""""""
" Haskell Plugins
""""""""""""""""""""""""""""""""""""""""
" 各種言語のリファレンスを参照する
"""" git cloneが必要
"""" git clone https://github.com/thinca/vim-ref.git
"""" NeoBundle 'thinca/vim-ref'
"""" cabal install hoogleが必要
"----- Haskellプラグイン -----
" インデントプラグイン
NeoBundle 'kana/vim-filetype-haskell'
" 外部コマンドghc(コンパイルコマンド)をvimから使えるように
NeoBundle 'eagletmt/ghcmod-vim'
" Haskellの補完プラグイン
NeoBundle 'ujihisa/neco-ghc'
" シンタックスチェック
" なんかが足らない
"NeoBundle 'osyo-manga/vim-watchdogs'
"""""" import文用
"""""" hoogleが必要
""""""NeoBundle 'ujihisa/unite-haskellimport'

call neobundle#end()

" Required:
filetype plugin indent on

" vim起動時にインストールされていないプラグインがあれば
" 起動時にインストールする
NeoBundleCheck

