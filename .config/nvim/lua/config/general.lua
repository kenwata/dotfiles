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

-- Completion
-- Built-in autocompletion (no plugin): pop up candidates while typing.
vim.o.autocomplete = true
-- Prepend "o" (omnifunc, wired to the LSP client automatically) so language-server
-- candidates get priority; see :help ins-autocompletion on source ordering.
vim.opt.complete:prepend("o")
vim.opt.completeopt:append("fuzzy")
-- Without this, fuzzy matching on a short prefix (e.g. "os") can rank an unrelated
-- long candidate (e.g. ChildProcessError) first and auto-select it; noselect shows
-- the menu without pre-selecting anything, so nothing is inserted until confirmed.
vim.opt.completeopt:append("noselect")
