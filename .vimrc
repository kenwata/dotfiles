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
" 設定
let NERDTreeShowHidden = 1

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

" インデントを表示
NeoBundle 'nathanaelkane/vim-indent-guides'

" テキストオブジェクトで置換
NeoBundle 'kana/vim-operator-replace.git'
NeoBundle 'kana/vim-operator-user.git'
NeoBundle 'kana/vim-textobj-user'

" なんだろう？
NeoBundle 'rhysd/vim-operator-surround'

""""""""""""""""""""""""""""
" Python plugins
""""""""""""""""""""""""""""
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


scriptencoding utf-8

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
set background=dark
" カラースキーマ指定
colorscheme hybrid

" 入力中のコマンドを表示
set showcmd

" 一行の文字数が多くてもきちんと描画する
set display=lastline

" terminalで256色表示を使う
set t_Co=256

"********** ハイライト表示 **********
" 対応括弧をハイライト表示する
set showmatch

" 対応括弧のハイライト時間を短くする(0.1秒)
set matchtime=1

" 行をハイライト
set cursorline

" 検索結果をハイライト 
set hlsearch

" ESC二回押しでハイライトを消す
nmap <silent> <Esc><Esc> :nohlsearch<CR>

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

" TAB,EFOなどを可視化
set list
set listchars=tab:>.,trail:_,eol:↲,extends:>,precedes:<,nbsp:%

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

" カーソル移動
inoremap <C-j> <Down>
inoremap <C-k> <Up>
inoremap <C-h> <Left>
inoremap <C-l> <Right>

" 行末まで一気に移動
inoremap <C-e> <END>

"+++++ normal mode +++++
" 分割ウィンドウ移動 
noremap sh <C-W>h
noremap sj <C-W>j
noremap sk <C-W>k
noremap sl <C-W>l

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

" ; と : を入れ替え
noremap ; :

"********** その他設定(後で変える) **********
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

"*********ステータスラインの設定**********
set laststatus=2

let g:gitgutter_sign_added = '✚ '
let g:gitgutter_sign_modified = '➜ '
let g:gitgutter_sign_removed = '✘ '

" lightline.vim
let g:lightline = {
        \ 'colorscheme': 'landscape',
        \ 'mode_map': {'c': 'NORMAL'},
        \ 'active': {
        \   'left': [
        \     ['mode', 'paste'],
        \     ['fugitive', 'gitgutter', 'filename'],
        \   ],
        \   'right': [
        \     ['lineinfo', 'syntastic'],
        \     ['percent'],
        \     ['charcode', 'fileformat', 'fileencoding', 'filetype'],
        \   ]
        \ },
        \ 'component_function': {
        \   'modified': 'MyModified',
        \   'readonly': 'MyReadonly',
        \   'fugitive': 'MyFugitive',
        \   'filename': 'MyFilename',
        \   'fileformat': 'MyFileformat',
        \   'filetype': 'MyFiletype',
        \   'fileencoding': 'MyFileencoding',
        \   'mode': 'MyMode',
        \   'syntastic': 'SyntasticStatuslineFlag',
        \   'charcode': 'MyCharCode',
        \   'gitgutter': 'MyGitGutter',
        \ },
        \ 'separator': { 'left': "", 'right': "" },
        \ 'subseparator': {'left': "", 'right': "" }
        \ }

function! MyModified()
  return &ft =~ 'help\|vimfiler\|gundo' ? '' : &modified ? '+' : &modifiable ? '' : '-'
endfunction

function! MyReadonly()
  return &ft !~? 'help\|vimfiler\|gundo' && &ro ? "" : ''
endfunction

function! MyFilename()
  return ('' != MyReadonly() ? MyReadonly() . ' ' : '') .
        \ (&ft == 'vimfiler' ? vimfiler#get_status_string() :
        \  &ft == 'unite' ? unite#get_status_string() :
        \  &ft == 'vimshell' ? substitute(b:vimshell.current_dir,expand('~'),'~','') :
        \ '' != expand('%:t') ? expand('%:t') : '[No Name]') .
        \ ('' != MyModified() ? ' ' . MyModified() : '')
endfunction

function! MyFugitive()
  try
    if &ft !~? 'vimfiler\|gundo' && exists('*fugitive#head')
      let _ = fugitive#head()
      return strlen(_) ? ""._ : ''
    endif
  catch
  endtry
  return ''
endfunction

function! MyFileformat()
  return winwidth('.') > 70 ? &fileformat : ''
endfunction

function! MyFiletype()
  return winwidth('.') > 70 ? (strlen(&filetype) ? &filetype : 'no ft') : ''
endfunction

function! MyFileencoding()
  return winwidth('.') > 70 ? (strlen(&fenc) ? &fenc : &enc) : ''
endfunction

function! MyMode()
  return winwidth('.') > 60 ? lightline#mode() : ''
endfunction

function! MyGitGutter()
  if ! exists('*GitGutterGetHunkSummary')
        \ || ! get(g:, 'gitgutter_enabled', 0)
        \ || winwidth('.') <= 90
    return ''
  endif
  let symbols = [
        \ g:gitgutter_sign_added . ' ',
        \ g:gitgutter_sign_modified . ' ',
        \ g:gitgutter_sign_removed . ' '
        \ ]
  let hunks = GitGutterGetHunkSummary()
  let ret = []
  for i in [0, 1, 2]
    if hunks[i] > 0
      call add(ret, symbols[i] . hunks[i])
    endif
  endfor
  return join(ret, ' ')
endfunction

" https://github.com/Lokaltog/vim-powerline/blob/develop/autoload/Powerline/Functions.vim
function! MyCharCode()
  if winwidth('.') <= 70
    return ''
  endif

  " Get the output of :ascii
  redir => ascii
  silent! ascii
  redir END

  if match(ascii, 'NUL') != -1
    return 'NUL'
  endif

  " Zero pad hex values
  let nrformat = '0x%02x'

  let encoding = (&fenc == '' ? &enc : &fenc)

  if encoding == 'utf-8'
    " Zero pad with 4 zeroes in unicode files
    let nrformat = '0x%04x'
  endif

  " Get the character and the numeric value from the return value of :ascii
  " This matches the two first pieces of the return value, e.g.
  " "<F>  70" => char: 'F', nr: '70'
  let [str, char, nr; rest] = matchlist(ascii, '\v\<(.{-1,})\>\s*([0-9]+)')

  " Format the numeric value
  let nr = printf(nrformat, nr)

  return "'". char ."' ". nr
endfunction

" インデントプラグインの設定
let g:indent_guides_auto_colors=0
" 奇数インデントのカラー
autocmd VimEnter,Colorscheme * :hi IndentGuidesOdd   ctermbg=23
" 偶数インデントのカラー
autocmd VimEnter,Colorscheme * :hi IndentGuidesEven  ctermbg=30
" vim立ち上げたときに、自動的にvim-indent-guidesをオンにする
let g:indent_guides_enable_on_vim_startup=1
" ガイドをスタートするインデントの
let g:indent_guides_guide_size=1
" 自動カラーを無効にする
" let g:indent_guides_auto_colors=0

" テキストオブジェクトで置換
map R <Plug>(operator-replace)

" 全角記号を半角2文字分として表示
" ※ターミナルでの設定も必要
set ambiwidth=double

