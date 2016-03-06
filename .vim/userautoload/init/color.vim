" color setting here

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
nmap <silent> <Space><Space> :nohlsearch<CR>

" コードの色分け
syntax enable
" 背景色
set background=dark

" terminalで256色表示を使う
set t_Co=256
