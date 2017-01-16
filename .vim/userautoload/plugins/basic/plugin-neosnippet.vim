" neosnipet setting here!
" insert mode : ctrl + b でスニペット(C-sはなぜか割り当て出来なかった)
imap <C-b> <Plug>(neosnippet_expand_or_jump)
smap <C-b> <Plug>(neosnippet_expand_or_jump)
xmap <C-b> <Plug>(neosnippet_expand_target)

imap <expr><TAB> neosnippet#expandable_or_jumpable() ?
\ "\<Plug>(neosnippet_expand_or_jump)"
\: pumvisible() ? "\<C-n>" : "\<TAB>"
smap <expr><TAB> neosnippet#expandable_or_jumpable() ?
\ "\<Plug>(neosnippet_expand_or_jump)"
\: "\<TAB>"

"smap <expr><TAB> neosnippet#expandable_or_jumpable() ?
"\ "\<Plug>(neosnippet_expand_or_jump)>" : "\<TAB>"

"if has('conceal')
"    set conceallevel=2 concealcursor=niv
"endif

"let g:neosnippet#enable_snipmate_compatibility = 1

let g:neosnippet#snippets_directory='~/.vim/dein/repos/github.com/Shougo/neosnippet-snippets/snippets'
