if exists('b:did_ftplugin_python')
    finish
endif

let b:did_ftplugin_python = 1

setlocal smarttab
setlocal expandtab
setlocal tabstop=2
setlocal shiftwidth=2
setlocal foldmethod=indent
setlocal commentstring=#%s

" - af: a function
" - if: inner function
" - ac: a class
" - ic: inner class
"
" this plugin has aditional key-bind
"  -  '[pf', ']pf': move to next/previous function
"  -  '[pc', ']pc': move to next/previous class
map <buffer> af <Plug>(textobj-python-function-a)
map <buffer> af <Plug>(textobj-python-function-a)
map <buffer> if <Plug>(textobj-python-function-i)
map <buffer> if <Plug>(textobj-python-function-i)
map <buffer> ac <Plug>(textobj-python-class-a)
map <buffer> ac <Plug>(textobj-python-class-a)
map <buffer> ic <Plug>(textobj-python-class-i)
map <buffer> ic <Plug>(textobj-python-class-i)

setlocal omnifunc=jedi#completions

" シンタックスハイライトについて
if version < 600
  syntax clear
elseif exists('b:current_after_syntax')
  finish
endif

" We need nocompatible mode in order to continue lines with backslashes.
" Original setting will be restored.
let s:cpo_save = &cpo
set cpo&vim

syn match pythonOperator "\(+\|=\|-\|\^\|\*\)"
syn match pythonDelimiter "\(,\|\.\|:\)"
syn keyword pythonSpecialWord self

hi link pythonSpecialWord    Special
hi link pythonDelimiter      Special

let b:current_after_syntax = 'python'

let &cpo = s:cpo_save
unlet s:cpo_save

" neocomplete setting
let g:jedi#auto_vim_configuration=0
let g:jedi#popup_select_first=0

if !exists('g:neocomplete#force_omni_input_patterns')
    let g:neocomplete#force_omni_input_patterns = {}
endif
"let g:neocomplete#force_omni_input_patterns.python = '\%([^. \t]\.\|^\s*@\|^\s*from\s.\+import \|^\s*from \|^\s*import \)\w*'
let g:neocomplete#force_omni_input_patterns.python = '\h\w*\|[^. \t]\.\w*'

" jedi-vimのドックのようなものを表示させない
setlocal completeopt-=preview

" キーマッピング
" 補完キーの設定この場合はCtrl+b
let g:jedi#completions_command = "<C-b>"

" syntastic
let g:syntastic_python_checkers = ['pyflakes', 'pep8']
