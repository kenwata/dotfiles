" カラースキーマをsolarizedに変更し、それに合わせてlightlineの色も変更する
command! -bar Solarized
            \ source ~\/.vim\/userautoload\/plugins\/colors\/plugin-solarized.vim |
            \ call lightline#init() |
            \ call lightline#colorscheme() |
            \ call lightline#update()
" カラースキーマとlightlineの色をデフォルトに戻す
command! -bar ColorReset
            \ source ~\/.vim\/userautoload\/plugins\/colors\/plugin-reset-colorscheme.vim |
            \ call lightline#init() |
            \ call lightline#colorscheme() |
            \ call lightline#update()
