" python  -> pip install flake8
" haskell -> from stack -> stack install ghc-mod
" vim     -> pip install vint
" js      -> npm install -g eslint
" r       -> ????

let g:ale_linters = {
            \ 'python': ['flake8'],
            \ 'haskell': ['ghc-mod'],
            \ 'javascript': ['eslint'],
            \ 'R': ['lintr'],
            \ 'vim': ['vint'],
            \ 'jsx': ['stylelint', 'eslint'],
            \}

" 開いたときはエラー表示しない
let g:ale_lint_on_enter = 0

" エラー・警告時にウィンドウ左に出力する文字
let g:ale_sign_error = '>>'
let g:ale_sign_warning = '--'

