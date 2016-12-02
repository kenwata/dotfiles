" neosnipet setting here!
imap <C-s> <Plug>(neosnippet_expand_or_jump)
smap <C-s> <Plug>(neosnippet_expand_or_jump)
xmap <C-s> <Plug>(neosnippet_expand_target)

smap <expr><TAB> neosnippet#expandable_or_jumpable() ?
\ "\<Plug>(neosnippet_expand_or_jump)>" : "\<TAB>"

"if has('conceal')
"    set conceallevel=2 concealcursor=niv
"endif

"let g:neosnippet#enable_snipmate_compatibility = 1
