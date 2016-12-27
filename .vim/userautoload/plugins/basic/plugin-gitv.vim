" refarence
" http://cohama.hateblo.jp/entry/20130517/1368806202
function! s:gitv_get_current_hash()
  return matchstr(getline('.'), '\[\zs.\{7\}\ze\]$')
endfunction

autocmd FileType git setlocal nofoldenable foldlevel=0
function! s:toggle_git_folding()
  if &filetype ==# 'git'
    setlocal foldenable!
  endif
endfunction

autocmd FileType gitv call s:my_gitv_settings()
function! s:my_gitv_settings()
  " 現在のカーソル位置にあるブランチ名を取得して
  " log上でブランチに checkout する。
  setlocal iskeyword+=/,-,.
  nnoremap <silent><buffer> C :<C-u>Git checkout <C-r><C-w><CR>
  " 現在のカーソル行のSHA1ハッシュを取得して
  " log上であらゆることを実行する
  " git rebase
  nnoremap <buffer> <Leader>rb :<C-u>Git rebase <C-r>=GitvGetCurrentHash()<CR><Space>
  " git revert
  nnoremap <buffer> <Leader>R :<C-u>Git revert <C-r>=GitvGetCurrentHash()<CR><CR>
  " git cherry-pick
  nnoremap <buffer> <Leader>h :<C-u>Git cherry-pick <C-r>=GitvGetCurrentHash()<CR><CR>
  " git reset --hard
  nnoremap <buffer> <Leader>rh :<C-u>Git reset --hard <C-r>=GitvGetCurrentHash()<CR>
  " ファイルのdiffではなく、変更されたファイルの一覧を見る
  " 右ウィンドウで「t」を押すことでdiffウィンドウ内のfoldを切り替える
  nnoremap <silent><buffer> t :<C-u>windo call <SID>toggle_git_folding()<CR>1<C-w>w
endfunction
