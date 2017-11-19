if exists("b:did_ftplugin_markdown")
    finish
endif

let b:did_ftplugin_markdown=1

setlocal expandtab
setlocal tabstop=2
setlocal softtabstop=2
setlocal shiftwidth=2
" 自動で折りたたまないようにする
let g:vim_markdown_folding_disabled=1
setlocal nofoldenable

" 自動改行を無効化
setlocal noautoindent

" プレビュー時にヘッダーを表示しない
let g:previm_show_header=0

" デフォルトのブラウザをfirefoxに移行したためいらなくなった
"if has('unix')
"  let g:previm_open_cmd = '/usr/bin/chromium-browser'
"endif

noremap <C-M> :PrevimOpen<CR>

