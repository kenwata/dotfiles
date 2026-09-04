-- UI
vim.o.number = true
vim.o.relativenumber = false
vim.o.wrap = true
vim.o.list = true
-- listchars holds a table value, which vim.o cannot accept.
vim.opt.listchars = { space = "·", tab = "▸ ", trail = "·", eol = "¬" }

-- Indent
vim.o.expandtab = true
vim.o.tabstop = 4
vim.o.shiftwidth = 4
vim.o.softtabstop = 4

-- Search
vim.o.hlsearch = true
vim.o.incsearch = true

-- Clipboard
vim.o.clipboard = "unnamedplus"

-- Encoding
-- Candidates are tried in order when opening a file. ucs-bom comes first so a
-- BOM is honoured before any heuristic runs; cp932 covers legacy Japanese files.
vim.o.fileencodings = "ucs-bom,utf-8,cp932"
