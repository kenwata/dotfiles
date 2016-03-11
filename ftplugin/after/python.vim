" ※ ※ 参考
" http://blog.livedoor.jp/okashi1/archives/51783080.html
" http://whileimautomaton.net/2008/09/07213145
"
" 「:e」 などでバッファをリロードした時に、
" ftpluginが何回もロードされるのを防ぐ
if exists("b.did_ftplugin_python")
    finish
endif

let b:did_ftplugin_python=1

setlocal expandtab
setlocal tabstop=2
setlocal softtabstop=2
setlocal shiftwidth=2
