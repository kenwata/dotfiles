"let g:python3_host_prog = '~/.pyenv/versions/3.6.0/bin/python3'
let g:python_host_prog = $PYENV_ROOT . '/shims/python'
let g:python3_host_prog = $PYENV_ROOT . '/versions/3.6.0/bin/python3'

runtime! userautoload/init/*.vim
runtime! userautoload/dein/*.vim

set runtimepath+=~/.vim/dein/repos/github.com/Shougo/deoplete.nvim/
set runtimepath+=~/.vim/dein/repos/github.com/Shougo/denite.nvim/

let g:deoplete#enable_at_startup = 1
