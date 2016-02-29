"**************************************************
"   プラグイン管理(NeoBundle)
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

call neobundle#end()

" Required:
filetype plugin indent on

" vim起動時にインストールされていないプラグインがあれば
" 起動時にインストールする
NeoBundleCheck

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

"**************************************************
"   ウィンドウ表示
"**************************************************
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
"syntax enable
syntax on
" 背景色
"set background=light
" カラースキーマ指定
"colorscheme solarized

" 入力中のコマンドを表示
set showcmd

" 一行の文字数が多くてもきちんと描画する
set display=lastline

" terminalで256色表示を使う
set t_Co=256

"**************************************************
"   ハイライト表示
"**************************************************
" 対応括弧をハイライト表示する
set showmatch

" 対応括弧のハイライト時間を短くする(0.1秒)
set matchtime=1

" 行をハイライト
set cursorline

" 検索結果をハイライト
set hlsearch


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
set incsearch

" 大文字と小文字が混在した検索に限り、大文字と小文字を区別する
set smartcase

" 置換時、gオプションをデフォルトで有効にする
set gdefault

"**************************************************
"   ステータスライン
"**************************************************
" ステータスラインを表示
set laststatus=2

" ステータスラインにファイル名を表示
set statusline+=%<%F

" 現在行を表示
set statusline+=[%p%%]

" 挿入モード時、ステータスラインの色を変更
let g:hi_insert = 'highlight StatusLine guifg=darkblue guibg=darkyellow gui=none ctermfg=blue ctermbg=yellow cterm=none'

if has('syntax')
  augroup InsertHook
    autocmd!
    autocmd InsertEnter * call s:StatusLine('Enter')
    autocmd InsertLeave * call s:StatusLine('Leave')
  augroup END
endif

let s:slhlcmd = ''
function! s:StatusLine(mode)
  if a:mode == 'Enter'
    silent! let s:slhlcmd = 'highlight ' . s:GetHighlight('StatusLine')
    silent exec g:hi_insert
  else
    highlight clear StatusLine
    silent exec s:slhlcmd
  endif
endfunction

function! s:GetHighlight(hi)
  redir => hl
  exec 'highlight '.a:hi
  redir END
  let hl = substitute(hl, '[\r\n]', '', 'g')
  let hl = substitute(hl, 'xxx', '', '')
  return hl
endfunction

"**************************************************
"   タブ/インデントの設定
"**************************************************
" タブ入力を複数の空白入力に置き換える
set expandtab

" タブの文字数を4つの空白にする
set tabstop=2

" 自動インデントでずれる幅を空白4つ分に設定
set shiftwidth=2

" 改行時に前のインデントを継続させる
set autoindent

" 改行時に入力された行の末尾に合わせて次のインデントを増減させる
set smartindent

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
"set clipboard=unnamedplus,autoselect 

" クリップボードにコピーしたものをvimで編集しているものに貼り付けた時、
" 自動的にset pasteモードに入り、自動インデントをしないようにする

if &term =~ "xterm"
    let &t_ti .= "\e[?2004h"
    let &t_te .= "\e[?2004l"
    let &pastetoggle = "\e[201~"

    function XTermPasteBegin(ret)
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

"**************************************************
" カーソル移動関連の設定 
"**************************************************
" 上下4行の視界を確保
set scrolloff=8

" 左右スクロール時の視界を確保
set sidescrolloff=10

" 文字のないところにカーソル移動を可能にする
set virtualedit=block

"**************************************************
" キーバインド
"**************************************************
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

"+++++ normal mode +++++
" 分割ウィンドウ移動 
noremap <C-H> <C-W>h
noremap <C-J> <C-W>j
noremap <C-K> <C-W>k
noremap <C-L> <C-W>l

" Ctrl + e でNERDTree表示、非表示
nnoremap <silent> <C-e> :NERDTreeToggle<CR>

" ウィンドウを水平に分割
nnoremap ss :<C-u>sp<CR>
" ウィンドウを垂直に分割
nnoremap sv :<C-u>vs<CR>
" ウィンドウを閉じる
nnoremap sq :<C-u>q<CR>
" バッファを閉じる
nnoremap sQ :<C-u>bd<CR>

"**************************************************
" その他設定(後で変える)
"**************************************************
" terminal接続を高速にする
set ttyfast

"" uniteの設定
" 入力モードで開始する
 let g:unite_enable_start_insert=1
" バッファ一覧
 noremap <C-P> :Unite buffer<CR>
" ファイル一覧
 noremap <C-N> :Unite -buffer-name=file file<CR>
" 最近使ったファイルの一覧
 noremap <C-Z> :Unite file_mru<CR>
" sourcesを「今開いているファイルのディレクトリ」とする
noremap :uff :<C-u>UniteWithBufferDir file -buffer-name=file<CR>

set background=dark

