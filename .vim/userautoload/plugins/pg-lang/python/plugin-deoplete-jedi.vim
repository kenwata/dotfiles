" Requirements
"   Python 3.x.x
"   pip3 install jedi
let g:deoplete#sources#jedi#python_path = system('type pyenv &>/dev/null && echo -n "$(pyenv root)/versions/$(cat $(pyenv root)/version | tail -n 1)/bin/python" || echo -n $(which python)')
" let g:deoplete#sources#jedi#python_path = $PYENV_ROOT . '/versions/3.7.1/bin/python3'

" file/include conflicting deoplete-jedi
let g:deoplete#ignore_sources = {}
let g:deoplete#ignore_sources.python =
\ ['buffer', 'dictionary', 'member', 'omni', 'tag', 'syntax', 'around']

let g:deoplete#sources#jedi#enable_cache = 1
let g:deoplete#sources#jedi#statement_length = 0
let g:deoplete#sources#jedi#short_types = 0
let g:deoplete#sources#jedi#show_docstring = 1
let g:deoplete#sources#jedi#worker_threads = 2
