" key mappings here
"+++++ insert mode +++++ 
" Ctrl + j で Esc
inoremap <silent> jj <Esc>
inoremap <silent> <C-j> j

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

nnoremap so <C-w>_<C-w>|
nnoremap sO <C-w>=

" j,kによる移動を折り返されたテキストでも自然にふるまう
nnoremap j gj
nnoremap k gk

" <Space>s で置換
noremap <Space>s :%s/

noremap <Space><Space> <Esc>

