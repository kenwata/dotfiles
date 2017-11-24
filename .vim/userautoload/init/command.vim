command! -bar LightlineUpdateSolarized
            \ source ~\/.vim\/userautoload\/plugins\/colors\/plugin-solarized.vim |
            \ call lightline#init() |
            \ call lightline#colorscheme() |
            \ call lightline#update()
