" vimfiler settings here

" vimデフォルトエクスプローラをvimfilerで置き換える
let g:vimfiler_as_default_explorer=1

noremap <Space>f :VimFiler<CR>
noremap <silent> :tree :VimFiler -split -simple -winwidth=35 -no-quit
"noremap <C-E> :VimFiler -split -simple -winwidth=35 -no-quit<ENTER>
nnoremap <silent> <C-e> :<C-u>VimFilerBufferDir -split -simple -winwidth=35 -toggle -no-quit<CR>
" 自動でカレントディレクトリを変更する
let g:vimfiler_enable_auto_cd=1
