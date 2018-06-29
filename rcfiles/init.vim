" Depends on pyenv versions
" jediなどの関係上、2.x系は明示的に無効化
" let g:python_host_prog = $PYENV_ROOT . '/versions/2.7.14/bin/python'
" let g:python3_host_prog = $PYENV_ROOT . '/versions/3.6.3/bin/python3'
" let g:python_host_prog = ''
let g:python_host_prog = $PYENV_ROOT . '/versions/2.7.14/bin/python'
let g:python3_host_prog = system('type pyenv &>/dev/null && echo -n "$(pyenv root)/versions/$(cat $(pyenv root)/version | head -n 1)/bin/python" || echo -n $(which python)')

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

