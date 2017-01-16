"let g:unite_source_history_yank_enable =1  "history/yankの有効化
nnoremap <leader>y :<C-u>Unite history/yank<CR>

let g:neoyank#file = $HOME.'/.vim/yankring.txt'
