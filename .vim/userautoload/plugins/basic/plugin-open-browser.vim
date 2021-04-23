" open-browser setting here!
let g:netrw_gx = 1 " disable netrw's gx mapping.
nmap gx <Plug>(openbrowser-smart-search)
vmap gx <Plug>(openbrowser-smart-search)

if has("mac")
    let g:openbrowser_browser_commands = [
    \   {
    \       "name": "open",
    \       "args": ["{browser}", "-a", "Google\ Chrome","{uri}"]
    \   }
    \ ]
endif
