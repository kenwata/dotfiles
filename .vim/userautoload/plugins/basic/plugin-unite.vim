" unite setting here

" 入力モードで開始する
let g:unite_enable_start_insert=1
" 大文字小文字を区別しない
let g:unite_enable_ignore_case = 1
let g:unite_enable_smart_case = 1

" バッファ一覧
noremap <Leader><Leader>b :Unite buffer<CR>
" ファイル一覧
noremap <Leader><Leader>f :Unite -buffer-name=file file<CR>
" 最近使ったファイルの一覧
noremap <Leader><Leader>u :Unite file_mru<CR>
" sourcesを「今開いているファイルのディレクトリ」とする
noremap <Leader><Leader>h :<C-u>UniteWithBufferDir file -buffer-name=file<CR>

" grep検索
nnoremap <silent> <Leader><Leader>ug  :<C-u>Unite grep:. -buffer-name=search-buffer<CR>
" カーソル位置の単語をgrep検索
nnoremap <silent> <Leader><Leader>cg :<C-u>Unite grep:. -buffer-name=search-buffer<CR><C-R><C-W>
" grep検索結果の再呼出
nnoremap <silent> <Leader><Leader>ur :<C-u>UniteResume search-buffer<CR>

" unite grep に ag(The Silver Searcher) を使う
if executable('ag')
  let g:unite_source_grep_command = 'ag'
  let g:unite_source_grep_default_opts = '--nogroup --nocolor --column'
  let g:unite_source_grep_recursive_opt = ''
endif
