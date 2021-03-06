" key mappings here

"**************************************************
" キーバインド
"**************************************************

" LeaderキーをSpaceにする
let mapleader = "\<Space>"

"+++++ insert mode +++++ 

" Ctrl + j で Esc
inoremap <silent> jj <Esc>

" カーソル移動
inoremap <C-j> <Down>
inoremap <C-k> <Up>
inoremap <C-h> <Left>
inoremap <C-l> <Right>

"inoremap <Leader>w <Esc>:<C-u>w<CR>
"inoremap <C-y> <BS>
inoremap <C-v> <Del>

"+++++ normal mode +++++

" ; と : を入れ替え
noremap ; :

" 分割ウィンドウ移動 
noremap sh <C-W>h
noremap sj <C-W>j
noremap sk <C-W>k
noremap sl <C-W>l

noremap <Leader>h 0
noremap <Leader>l $

" ウィンドウを水平に分割
nnoremap ss :<C-u>sp<CR>
" ウィンドウを垂直に分割
nnoremap sv :<C-u>vs<CR>
" ウィンドウを閉じる
nnoremap sq :<C-u>q<CR>
" バッファを閉じる
nnoremap sQ :<C-u>bd<CR>
" コマンド履歴
nnoremap q; q:

" タブ操作
nnoremap st :<C-u>tabnew<CR>
nnoremap sn gt
nnoremap sp gT

" j,kによる移動を折り返されたテキストでも自然にふるまう
nnoremap j gj
nnoremap k gk

" <Leader>s で置換
nnoremap <Leader>s :<C-u>%s/

" space3回押しでハイライトを消す
nnoremap <silent> <Leader><Leader><Leader> :<C-u>nohlsearch<CR>

" 分割したウィンドウそのものを移動
" 下に移動
nnoremap sJ <C-w>J
" 上に移動
nnoremap sK <C-w>K
" 右に移動
nnoremap sL <C-w>L
" 左に移動
nnoremap sH <C-w>H
" 一番左上に移動
nnoremap <S-h> <C-w>t
" 一番右下に移動
nnoremap <S-l> <C-w>b

" / で検索時の結果数を表示する
nnoremap <expr> / _(":%s/<Cursor>/&/gn")

function! s:move_cursor_pos_mapping(str, ...)
    let left = get(a:, 1, "<Left>")
    let lefts = join(map(split(matchstr(a:str, '.*<Cursor>\zs.*\ze'), '.\zs'), 'left'), "")
    return substitute(a:str, '<Cursor>', '', '') . lefts
endfunction

function! _(str)
    return s:move_cursor_pos_mapping(a:str, "\<Left>")
endfunction

" 行末のスペースを削除
noremap rs :<C-u>%s/ *$//<CR>
" 連続する空白行を1つの空白にする
noremap <Leader>t :<C-u>%s/ *$/ /c<CR>

" 画面分割状態からDiffを取る
nnoremap ,d :windo diffthis<CR>
nnoremap ,o :diffoff<CR>

" エンコードをcp932で開き直す
nnoremap <silent> <Leader>w :<C-u>e ++enc=cp932<CR>
