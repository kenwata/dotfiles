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

let g:lightline_delphinus_use_powerline_glyphs=1
"let g:lightline_delphinus_use_nerd_fonts_glyphs=1
let g:lightline_delphinus_colorscheme="nord_improved"
