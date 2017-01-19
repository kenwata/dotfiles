if exists("b:did_ftplugin_haskell")
    finish
endif

let b:did_ftplugin_haskell=1

" ghc-modのパスを追加
let $PATH = $PATH . ':' . expand('~/.cabal/bin')

setlocal expandtab
setlocal tabstop=4
setlocal softtabstop=4
setlocal shiftwidth=4

" 自動で折りたたまないようにする
setlocal nofoldenable

map <silent> gt :GhcModType<CR>
map <silent> gc :GhcModTypeClear<CR>
