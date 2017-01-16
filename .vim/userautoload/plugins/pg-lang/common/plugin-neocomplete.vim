"Note: This option must set it in .vimrc(_vimrc).  NOT IN .gvimrc(_gvimrc)!

"let g:neocomplete#force_overwrite_completefunc = 1
"" AutoCompPopを無効にする
let g:acp_enableAtStartup = 0
" neocompleteを有効にする
let g:neocomplete#enable_at_startup = 1
" smarrt case有効化。 大文字が入力されるまで大文字小文字の区別を無視する
let g:neocomplete#enable_smart_case = 1
" 補完が自動で開始される文字数
let g:neocomplete#sources#syntax#min_keyword_length = 3
" neocompleteを自動的にロックするバッファ名のパターン
let g:neocomplete#lock_buffer_name_pattern = '\*ku\*'

" Plugin key-mappings.
" ※他の割当に変更が必要
inoremap <expr><C-g>     neocomplete#undo_completion()
inoremap <expr><C-m>     neocomplete#complete_common_string()

" Recommended key-mappings.
" <CR>: close popup and save indent.
inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>

function! s:my_cr_function()
  " return neocomplete#close_popup() . "\<CR>"
  " For no inserting <CR> key.
  return pumvisible() ? neocomplete#close_popup() : "\<CR>"
endfunction

" <C-u>, <BS>: close popup and delete backword char.
" ctrl + u で、インデント開始まで削除
inoremap <expr><C-u> neocomplete#smart_close_popup()."\<C-u>"
"inoremap <expr><BS> neocomplete#smart_close_popup()."\<C-u>"
"inoremap <expr><C-y>  neocomplete#close_popup()
"inoremap <expr><C-e>  neocomplete#cancel_popup()

" Close popup by Enter.
inoremap <expr><CR> pumvisible() ? neocomplete#close_popup() : "\<CR>"

" <TAB>: completion.
" neosnippetが効かなくなってしまうので無効化
inoremap <expr><TAB> pumvisible() ? "\<C-n>" : "\<TAB>"
inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<S-TAB>


"if neobundle#is_installed('neocomplete')
""Note: This option must set it in .vimrc(_vimrc).  NOT IN .gvimrc(_gvimrc)!  let g:neocomplete#force_overwrite_completefunc = 1
" AutoCompPopを無効にする let g:acp_enableAtStartup = 0 
" neocompleteを有効にする let g:neocomplete#enable_at_startup = 1
"    " smarrt case有効化。 大文字が入力されるまで大文字小文字の区別を無視する
"    let g:neocomplete#enable_smart_case = 1
"    " 補完が自動で開始される文字数
"    let g:neocomplete#sources#syntax#min_keyword_length = 3
"    " neocompleteを自動的にロックするバッファ名のパターン
"    let g:neocomplete#lock_buffer_name_pattern = '\*ku\*'
"    " Plugin key-mappings.
"    " ※他の割当に変更が必要
"    inoremap <expr><C-g>     neocomplete#undo_completion()
"    inoremap <expr><C-m>     neocomplete#complete_common_string()
"
"    " Recommended key-mappings.
"    " <CR>: close popup and save indent.
"    inoremap <silent> <CR> <C-r>=<SID>my_cr_function()<CR>
"    function! s:my_cr_function()
"      " return neocomplete#close_popup() . "\<CR>"
"      " For no inserting <CR> key.
"      return pumvisible() ? neocomplete#close_popup() : "\<CR>"
"    endfunction
"    " <TAB>: completion.
"    inoremap <expr><TAB>  pumvisible() ? "\<C-n>" : "\<TAB>"
"    " <C-u>, <BS>: close popup and delete backword char.
"    " ctrl + u で、インデント開始まで削除
"    inoremap <expr><C-u> neocomplete#smart_close_popup()."\<C-u>"
"    "inoremap <expr><BS> neocomplete#smart_close_popup()."\<C-u>"
"    "inoremap <expr><C-y>  neocomplete#close_popup()
"    "inoremap <expr><C-e>  neocomplete#cancel_popup()
"
"    " Close popup by <Space>.
"    inoremap <expr><Leader> pumvisible() ? neocomplete#close_popup() : "\<Space>"
"elseif neobundle#is_installed('neocomplcache')
"    " neocomplcache用設定
"    let g:neocomplcache_enable_at_startup = 1
"    let g:neocomplcache_enable_ignore_case = 1
"    let g:neocomplcache_enable_smart_case = 1
"    if !exists('g:neocomplcache_keyword_patterns')
"        let g:neocomplcache_keyword_patterns = {}
"    endif
"    let g:neocomplcache_keyword_patterns._ = '\h\w*'
"    let g:neocomplcache_enable_camel_case_completion = 1
"    let g:neocomplcache_enable_underbar_completion = 1
"endif
"inoremap <expr><TAB> pumvisible() ? "\<C-n>" : "\<TAB>"
"inoremap <expr><S-TAB> pumvisible() ? "\<C-p>" : "\<S-TAB>
