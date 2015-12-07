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

" ファイルのtree表示
NeoBundle 'scrooloose/nerdtree'
" VimからGitの操作ができる
NeoBundle 'tpope/vim-fugitive'
"" 設定
" grep検索の実行後にQuickFix Listを表示
autocmd QuickFixCmdPost *grep* cwindow
" ステータス行に現在のgitブランチを表示する
set statusline+=%{fugitive#statusline()}

" カラーテーマ(solarized)
NeoBundle 'altercation/vim-colors-solarized'


call neobundle#end()

" Required:
filetype plugin indent on

" vim起動時にインストールされていないプラグインがあれば
" 起動時にインストールする
NeoBundleCheck

"****************************************************************

"********** vi 互換ではなく Vim のデフォルト設定にする **********
set nocompatible

"********** エンコード **********
" エンコード
set encoding=utf-8

" ファイルエンコード
set fileencoding=utf-8

"********** ウィンドウ表示 **********
" 行番号を表示
set number

" 右下に表示される行、列番号を表示
set ruler

" コマンドを画面最下部に表示する
set showcmd

" ウィンドウの幅より長い行を折り返し
set wrap

" ファイル名を表示する
set title

" コードの色分け
syntax enable
" 背景色
set background=light
" カラースキーマ指定
colorscheme solarized

" 入力中のコマンドを表示
set showcmd

" 一行の文字数が多くてもきちんと描画する
set display=lastline

"********** ハイライト表示 **********
" 対応括弧をハイライト表示する
set showmatch

" 対応括弧のハイライト時間を短くする(0.1秒)
set matchtime=1

" 行をハイライト
set cursorline

"********** 補完 **********
" 
set infercase

" 補完メニューの高さ設定
set pumheight=10

"********** 検索 **********
" 小文字の検索でも大文字も見つかるようにする
set ignorecase

" インクリメンタルサーチを行う
set incsearch

" 大文字と小文字が混在した検索に限り、大文字と小文字を区別する
set smartcase

" 置換時、gオプションをデフォルトで有効にする
set gdefault

"********** タブ/インデントの設定 **********
" タブ入力を複数の空白入力に置き換える
set expandtab

" タブの文字数を4つの空白にする
set tabstop=4

" 自動インデントでずれる幅を空白4つ分に設定
set shiftwidth=4

" 改行時に前のインデントを継続させる
set autoindent

" 改行時に入力された行の末尾に合わせて次のインデントを増減させる
set smartindent

"********** ファイル処理関連 ********** 
" :e などでファイルを開く際にフォルダが存在しない場合は自動作成
function! s:mkdir(dir, force)
  if !isdirectory(a:dir) && (a:force ||
        \ input(printf('"%s" does not exist. Create? [y/N]', a:dir)) =~? '^y\%[es]$')
    call mkdir(iconv(a:dir, &encoding, &termencoding), 'p')
  endif
endfunction

" 保存されていないファイルがある時は、終了前に保存確認
set confirm

" 保存されていないファイルがある時でも、別のファイルを開ける
set hidden

" .swapファイルを作らない
set noswapfile

" ファイル保存時にバックアップファイルを作らない
set nobackup

"********** カーソル移動関連の設定 ********** 
" 上下4行の視界を確保
set scrolloff=4

" 左右スクロール時の視界を確保
set sidescrolloff=10

" 文字のないところにカーソル移動を可能にする
set virtualedit=block

"********** キーバインド **********
"+++++ insert mode +++++ 
" Ctrl + j で Esc
inoremap <silent> jj <Esc>
inoremap <silent> <C-j> j

" ; と : を入れ替え
noremap ; :

" カーソル移動
inoremap <C-j> <Down>
inoremap <C-k> <Up>
inoremap <C-h> <Left>
inoremap <C-l> <Right>

" その他設定(後で変える)
""set background=dark
