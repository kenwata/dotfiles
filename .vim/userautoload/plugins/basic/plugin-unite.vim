" unite setting here

" 入力モードで開始する
let g:unite_enable_start_insert=1
" バッファ一覧
noremap ,ub :Unite buffer<CR>
" ファイル一覧
noremap ,uf :Unite -buffer-name=file file<CR>
" 最近使ったファイルの一覧
noremap ,uu :Unite file_mru<CR>
" sourcesを「今開いているファイルのディレクトリ」とする
noremap ,ucf :<C-u>UniteWithBufferDir file -buffer-name=file<CR>

