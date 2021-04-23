let maplocalleader = ","

" deoplete
" Use deoplete.
"let g:deoplete#enable_at_startup = 1
" Use smartcase.
"let g:deoplete#enable_smart_case = 1
" for Nvim-R
if !exists('g:deoplete#omni_patterns')
    let g:deoplete#omni_patterns = {}
endif
let g:deoplete#omni_patterns.r = '[[:alnum:].\\]\+'

" nvim-r
" let R_tmux_split = 1
" 非推奨になった
" let R_vsplit = 1
let R_rconsole_width = winwidth(0) / 2
autocmd VimResized * let R_rconsole_width = winwidth(0) / 2

"let R_assign = 0
"
"let R_nvimpager = "horizontal"
"
"let R_objbr_place = "console,right"
"let R_objbr_opendf = 0
