" javascript plugins setting here

autocmd FileType javascript :setl omnifunc=jscomplete#CompleteJS

let g:syntastic_enable_signs=1
let g:syntastic_auto_loc_list=2

let g:syntastic_javascript_checker = "jshint"

au FileType javascript set dictionary+=$HOME/.vim/bundle/vim-node-dict/dict/node.dict

