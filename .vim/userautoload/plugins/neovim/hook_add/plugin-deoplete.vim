let g:deoplete#enable_at_startup = 1
let g:deoplete#auto_complete_delay = 0
let g:deoplete#auto_refresh_delay = 100
let g:deoplete#enable_camel_case = 0
let g:deoplete#enable_ignore_case = 0
let g:deoplete#enable_refresh_always = 0
let g:deoplete#enable_smart_case = 1
let g:deoplete#file#enable_buffer_path = 1
let g:deoplete#max_list = 10000

" omnifunc
" initialize
let g:deoplete#omni#input_patterns = {}

" file/include conflicting deoplete-jedi
let g:deoplete#ignore_sources = {}
let g:deoplete#ignore_sources.python =
\ ['buffer', 'dictionary', 'member', 'omni', 'tag', 'syntax', 'around']

let g:deoplete#sources#jedi#statement_length = 0
let g:deoplete#sources#jedi#short_types = 0
let g:deoplete#sources#jedi#show_docstring = 1
let g:deoplete#sources#jedi#worker_threads = 2
