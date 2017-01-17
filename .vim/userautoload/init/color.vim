" color setting here

"********** ハイライト表示 **********
" 背景色
set background=dark

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

" when open vim from terminal,
" synchronize the vim's background transparency to terminal's one.
if !has('gui_running')
    augroup seiya
        autocmd!
        autocmd VimEnter,ColorScheme * highlight Normal ctermbg=none
        autocmd VimEnter,ColorScheme * highlight LineNr ctermbg=none
        autocmd VimEnter,ColorScheme * highlight SignColumn ctermbg=none
        autocmd VimEnter,ColorScheme * highlight VertSplit ctermbg=none
        autocmd VimEnter,ColorScheme * highlight NonText ctermbg=none
    augroup END
endif

