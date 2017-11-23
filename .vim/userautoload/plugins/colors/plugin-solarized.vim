" colorscheme solarized
" let g:solarized_termcolors=256
" set background=light
" syntax enable
" filetype plugin indent on

let g:solarized_termcolors=256
set t_Co=256
set background=light
colorscheme solarized

let g:solarized_contrast = "high"
let g:solarized_visibility = "high"


" lightline 設定
"let g:lightline = {
"            \ 'colorscheme': 'solarized'
"            \}
let g:lightline_delphinus_colorscheme="solarized_improved"
let g:lightline['colorscheme']="solarized_improved"

function! s:ale_string(mode)
  if !exists('g:ale_buffer_info')
    return ''
  endif

  let l:buffer = bufnr('%')
  let [l:error_count, l:warning_count] = ale#statusline#Count(l:buffer)
  let [l:error_format, l:warning_format, l:no_errors] = g:ale_statusline_format

  if a:mode == 0 " Error
    return l:error_count ? printf(l:error_format, l:error_count) : ''
  elseif a:mode == 1 " Warning
    return l:warning_count ? printf(l:warning_format, l:warning_count) : ''
  endif

  return l:error_count == 0 && l:warning_count == 0 ? l:no_errors : ''
endfunction

augroup LightLineOnALE
  autocmd!
  autocmd User ALELint call lightline#update()
augroup END

