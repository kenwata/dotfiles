if exists("b:did_ftplugin_python")
    finish
endif

let b:did_ftplugin_python=1

setlocal smarttab
setlocal expandtab
setlocal tabstop=4
setlocal shiftwidth=4
setlocal softtabstop=4

setlocal completeopt-=preview
