" indent-guides setting here!

" インデントプラグインの設定
let g:indent_guides_auto_colors=0
" 奇数インデントのカラー
autocmd VimEnter,Colorscheme * :hi IndentGuidesOdd  guibg=237 ctermbg=237
" 偶数インデントのカラー
autocmd VimEnter,Colorscheme * :hi IndentGuidesEven guibg=245 ctermbg=245
" vim立ち上げたときに、自動的にvim-indent-guidesをオンにする
let g:indent_guides_enable_on_vim_startup=1
" ガイドをスタートするインデントの
let g:indent_guides_guide_size=1
" 自動カラーを無効にする
" let g:indent_guides_auto_colors=0

