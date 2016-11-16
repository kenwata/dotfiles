" key mappings here

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

inoremap ,w <Esc>:<C-u>w<CR>

"+++++ normal mode +++++
" 分割ウィンドウ移動 
noremap sh <C-W>h
noremap sj <C-W>j
noremap sk <C-W>k
noremap sl <C-W>l
noremap <Space>h 0
noremap <Space>l $

" Ctrl + e でNERDTree表示、非表示

" ウィンドウを水平に分割
nnoremap ss :<C-u>sp<CR>
" ウィンドウを垂直に分割
nnoremap sv :<C-u>vs<CR>
" ウィンドウを閉じる
nnoremap sq :<C-u>q<CR>
" バッファを閉じる
nnoremap sQ :<C-u>bd<CR>

" j,kによる移動を折り返されたテキストでも自然にふるまう
nnoremap j gj
nnoremap k gk

" <Space>s で置換
noremap <Space>s :%s/
" <Space><Space>でエスケープ
noremap <Space><Space> <Esc>

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
noremap <S-h> <C-w>t
" 一番右下に移動
noremap <S-l> <C-w>b
