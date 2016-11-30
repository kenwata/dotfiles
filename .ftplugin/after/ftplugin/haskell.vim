if exists("b:did_ftplugin_haskell")
    finish
endif

let b:did_ftplugin_haskell=1

setlocal expandtab
setlocal tabstop=2
setlocal softtabstop=2
setlocal shiftwidth=2

" 自動で折りたたまないようにする
setlocal nofoldenable

map <silent> gt :GhcModType<CR>
map <silent> gc :GhcModTypeClear<CR>
