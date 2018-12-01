" Depends on pyenv versions
"   > pyenv global system 3.x.x
let g:python_host_prog  = system('type pyenv &>/dev/null && echo -n "$(pyenv root)/versions/$(cat $(pyenv root)/version | head -n 1)/bin/python" || echo -n $(which python)')
let g:python3_host_prog = system('type pyenv &>/dev/null && echo -n "$(pyenv root)/versions/$(cat $(pyenv root)/version | tail -n 1)/bin/python" || echo -n $(which python)')

" ロードする順番を指定
runtime! userautoload/init/basic.vim
runtime! userautoload/init/keybinding.vim
runtime! userautoload/init/color.vim
runtime! userautoload/init/command.vim
runtime! userautoload/dein/dein-load.vim

set runtimepath+=~/.cache/dein/repos/github.com/Shougo/deoplete.nvim/
set runtimepath+=~/.cache/dein/repos/github.com/Shougo/denite.nvim/
set runtimepath+=~/.cache/dein/repos/github.com/zchee/deoplete-jedi/

let g:deoplete#enable_at_startup = 1

