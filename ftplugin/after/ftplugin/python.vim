if exists("b:did_ftplugin_python")
    finish
endif

let b:did_ftplugin_python=1

setlocal smarttab
setlocal expandtab
setlocal tabstop=4
setlocal shiftwidth=4
setlocal softtabstop=4
"setlocal foldmethod=indent
setlocal commentstring=#%s

" deoplete 上部に description を表示しない
setlocal completeopt-=preview

" コマンド業を2行分確保 (Shougo/echodoc.vim 用)
setlocal cmdheight=2

python3 << EOF
import subprocess
import sys
path = subprocess.run(['python','-c','import site; print(site.getsitepackages()[0])'],
                      stdout=subprocess.PIPE).stdout
path = path.strip()
path = path.decode('utf-8')
path = str(path)

if not path in sys.path:
    sys.path.append(path)
EOF

if !has("nvim")
  " - af: a function
  " - if: inner function
  " - ac: a class
  " - ic: inner class

  " this plugin has aditional key-bind
  "  -  '[pf', ']pf': move to next/previous function
  "  -  '[pc', ']pc': move to next/previous class
  xmap <buffer> af <Plug>(textobj-python-function-a)
  omap <buffer> af <Plug>(textobj-python-function-a)
  xmap <buffer> if <Plug>(textobj-python-function-i)
  omap <buffer> if <Plug>(textobj-python-function-i)
  xmap <buffer> ac <Plug>(textobj-python-class-a)
  omap <buffer> ac <Plug>(textobj-python-class-a)
  xmap <buffer> ic <Plug>(textobj-python-class-i)
  omap <buffer> ic <Plug>(textobj-python-class-i)

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

  " 画面の上部に勝手にポップアップが出ないようにする
  setlocal completeopt-=preview

  let g:jedi#auto_initialization = 1
  let g:jedi#auto_vim_configuration = 1

  if !exists('g:neocomplete#force_omni_input_patterns')
          let g:neocomplete#force_omni_input_patterns = {}
  endif

  let g:neocomplete#force_omni_input_patterns.python = '\h\w*\|[^. \t]\.\w*'

  let g:jedi#completions_command = "<C-Space>"
endif

"if has("nvim")
"
"endif

" Syntastic の Flake8について
" 特定のエラーを出力しない場合は、以下のように記述
" let g:syntastic_python_flake8_args = '--ignore="F401,F403"'
let g:ale_python_flake8_executable = 'flake8'

" E402 : impot文はファイルの先頭orドックストリングの直後
"        (os.pardirやos.appendなどするとエラーになるのでoff)
" E501 : 80文字以上警告
" E731 : do not assign a lambda expression, use a def
"        ラムダ式使うと警告出るのでoff
" F401 : imported but unused
" F403 : using wildcard imports
" W391 : blank line at end of file
let g:ale_python_flake8_args = '--ignore=E127,E402,E501,E731,F401,F403,W391'
let g:ale_python_flake8_options = '--ignore=E127,E402,E501,E731,F401,F403,W391'
