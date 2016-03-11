" コードの色分け
"syntax enable
syntax on
" 背景色
set background=dark

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

" ESC二回押しでハイライトを消す
nmap <silent> <Esc><Esc> :nohlsearch<CR>

