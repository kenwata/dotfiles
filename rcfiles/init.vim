" Depends on pyenv versions
"let g:python3_host_prog = '~/.pyenv/versions/3.6.0/bin/python3'
"let g:python_host_prog = $PYENV_ROOT . '/shims/python'
let g:python_host_prog = $PYENV_ROOT . '/versions/2.7.9/bin/python'
let g:python3_host_prog = $PYENV_ROOT . '/versions/3.6.1/bin/python3'

" ロードする順番を指定
runtime! userautoload/init/basic.vim
runtime! userautoload/init/keybinding.vim
runtime! userautoload/init/color.vim
runtime! userautoload/init/command.vim
runtime! userautoload/dein/dein-load.vim

set runtimepath+=~/.vim/dein/repos/github.com/Shougo/deoplete.nvim/
set runtimepath+=~/.vim/dein/repos/github.com/Shougo/denite.nvim/
set runtimepath+=~/.vim/dein/repos/github.com/zchee/deoplete-jedi/

let g:deoplete#enable_at_startup = 1
