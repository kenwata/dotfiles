" let g:deoplete#sources#jedi#python_path = $PYENV_ROOT . '/versions/3.6.3/bin/python3'
let g:deoplete#sources#jedi#python_path = $PYENV_ROOT . '/versions/anaconda3-5.0.1/bin/python3'

" file/include conflicting deoplete-jedi
let g:deoplete#ignore_sources = {}
let g:deoplete#ignore_sources.python =
\ ['buffer', 'dictionary', 'member', 'omni', 'tag', 'syntax', 'around']

let g:deoplete#sources#jedi#enable_cache = 1
let g:deoplete#sources#jedi#statement_length = 0
let g:deoplete#sources#jedi#short_types = 0
let g:deoplete#sources#jedi#show_docstring = 1
let g:deoplete#sources#jedi#worker_threads = 2
