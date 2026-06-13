vim.g.mapleader = " "

vim.opt.number = true
vim.opt.relativenumber = false

vim.opt.clipboard = "unnamedplus"

vim.opt.wrap = true

-- 不可視文字の可視化
vim.opt.list = true
vim.opt.listchars = { space = "·", tab = "▸ ", trail = "·", eol = "¬" }

vim.opt.expandtab = true
vim.opt.tabstop = 4
vim.opt.shiftwidth = 4
vim.opt.softtabstop = 4

vim.keymap.set("i", "jj", "<Esc>", { noremap = true, silent = true })

-- insert モードでの移動
vim.keymap.set("i", "<C-h>", "<Left>",  { noremap = true, silent = true, desc = "左へ移動" })
vim.keymap.set("i", "<C-l>", "<Right>", { noremap = true, silent = true, desc = "右へ移動" })
vim.keymap.set("i", "<C-k>", "<Up>",    { noremap = true, silent = true, desc = "上へ移動" })
vim.keymap.set("i", "<C-j>", "<Down>",  { noremap = true, silent = true, desc = "下へ移動" })

-- 検索ハイライト
vim.opt.hlsearch = true
vim.opt.incsearch = true
vim.keymap.set("n", "<leader><leader><leader>", "<cmd>nohlsearch<CR>", { noremap = true, silent = true, desc = "検索ハイライトを消去" })

-- 折り返し行を含む表示行単位で移動
vim.keymap.set("n", "j", "gj", { noremap = true, silent = true })
vim.keymap.set("n", "k", "gk", { noremap = true, silent = true })

-- ウィンドウ分割
vim.keymap.set("n", "ss", "<C-w>s", { noremap = true, silent = true, desc = "上下に分割" })
vim.keymap.set("n", "sv", "<C-w>v", { noremap = true, silent = true, desc = "左右に分割" })

-- ウィンドウ間移動
vim.keymap.set("n", "sh", "<C-w>h", { noremap = true, silent = true, desc = "左のウィンドウへ移動" })
vim.keymap.set("n", "sl", "<C-w>l", { noremap = true, silent = true, desc = "右のウィンドウへ移動" })
