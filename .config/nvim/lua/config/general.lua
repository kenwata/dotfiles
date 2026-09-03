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
