if exists("b:did_ftplugin_rust")
    finish
endif

let b:did_ftplugin_rust=1

setlocal smarttab
setlocal expandtab
setlocal tabstop=4
setlocal shiftwidth=4
setlocal softtabstop=4


if executable('racer')
    let g:deoplete#sources#rust#racer_binary = systemlist("which racer")[0]
endif

let source_path_rust = systemlist("rustc --print sysroot")[0] . "/lib/rustlib/src/rust/src"

" if isdirectory(s:source_path)
if isdirectory(source_path_rust)
    let g:deoplete#sources#rust#rust_source_path = source_path_rust
    let g:deoplete#sources#rust#show_duplicates = 1
    let g:deoplete#sources#rust#disable_keymap = 1
    nmap <buffer> gd <plug>DeopleteRustGoToDefinitionDefault
    nmap <buffer> K  <plug>DeopleteRustShowDocumentation
endif
