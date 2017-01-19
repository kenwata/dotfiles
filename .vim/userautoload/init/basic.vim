" command 'set' and others write here!

"**************************************************
"   vi 互換ではなく Vim のデフォルト設定にする 
"**************************************************
set nocompatible

"**************************************************
"   エンコード 
"**************************************************
set encoding=utf-8

" ファイルエンコード
set fileencoding=utf-8

scriptencoding utf-8

"**************************************************
"   ウィンドウ表示
"**************************************************
" 行番号を表示
set number

" 右下に表示される行、列番号を表示
set ruler

" ウィンドウの幅より長い行を折り返し
set wrap

" ファイル名を表示する
set title

" 入力中のコマンドを表示
set showcmd

" 一行の文字数が多くてもきちんと描画する
set display=lastline

" コマンドモードの補完
set wildmenu
" 保存するコマンド履歴の数
set history=5000

"**************************************************
"   補完
"**************************************************
set infercase

" 補完メニューの高さ設定
set pumheight=10

"**************************************************
"   検索*
"**************************************************
" 小文字の検索でも大文字も見つかるようにする
set ignorecase

" インクリメンタルサーチを行う
" 大文字と小文字が混在した検索に限り、大文字と小文字を区別する
set incsearch

set smartcase

" 置換時、gオプションをデフォルトで有効にする
set gdefault

"**************************************************
"   タブ/インデントの設定
"**************************************************
" タブ入力を複数の空白入力に置き換える
set expandtab

" タブの文字数を4つの空白にする
set tabstop=4

" 自動インデントでずれる幅を空白4つ分に設定
set shiftwidth=4

" 改行時に前のインデントを継続させる
set autoindent

" 改行時に入力された行の末尾に合わせて次のインデントを増減させる
" TODO 要らなくなるかもしれないので。。下の方に変更必要？？
"set smartindent
set nosmartindent

" TAB,EFOなどを可視化
set list
set listchars=tab:>.,trail:_,eol:↲,extends:>,precedes:<,nbsp:%

"**************************************************
"   コピペなど
"**************************************************
" クリップボードを利用する設定
set guioptions+=a

" yankしたテキストをクリップボードに格納
" linux環境ではunnamedplus、その他環境はunnamedで設定するらしい
set clipboard=unnamedplus,autoselect 

" クリップボードにコピーしたものをvimで編集しているものに貼り付けた時、
" 自動的にset pasteモードに入り、自動インデントをしないようにする

if &term =~ "xterm"
    let &t_ti .= "\e[?2004h"
    let &t_te .= "\e[?2004l"
    let &pastetoggle = "\e[201~"

    function! XTermPasteBegin(ret)
        set paste
        return a:ret
    endfunction

    noremap <special> <expr> <Esc>[200~ XTermPasteBegin("0i")
    inoremap <special> <expr> <Esc>[200~ XTermPasteBegin("")
    cnoremap <special> <Esc>[200~ <nop>
    cnoremap <special> <Esc>[201~ <nop>
endif

"**************************************************
" ファイル処理関連 
"**************************************************
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

set nowritebackup

"**************************************************
" カーソル移動関連の設定 
"**************************************************
" 上下4行の視界を確保
set scrolloff=8

" 左右スクロール時の視界を確保
set sidescrolloff=10

" 文字のないところにカーソル移動を可能にする
set virtualedit=block

" terminal接続を高速にする
set ttyfast

" スクリーンベルを無効化
set t_vb=
set novisualbell

" ステータスラインを常に表示
set laststatus=2

" 全角記号を半角2文字分として表示
" ※ターミナルでの設定も必要
set ambiwidth=double

" バックスペースを有効化？
set backspace=start,indent,eol

"**************************************************
"   ハイライト表示
"**************************************************

" 背景色
set background=dark

" 対応括弧をハイライト表示する
set showmatch

" 対応括弧のハイライト時間を短くする(0.1秒)
set matchtime=1

" 行をハイライト
set cursorline

" 検索結果をハイライト 
set hlsearch

" terminalで256色表示を使う
set t_Co=256
