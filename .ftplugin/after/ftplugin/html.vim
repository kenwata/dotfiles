if exists("b:did_ftplugin_html")
    finish
endif

let b:did_ftplugin_html=1

setlocal expandtab
setlocal tabstop=2
setlocal softtabstop=2
setlocal shiftwidth=2

noremap <C-M> :execute "OpenBrowser" expand("%:p")<CR>

