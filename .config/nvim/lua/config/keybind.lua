-- Insert mode cursor movement
vim.keymap.set("i", "jj", "<Esc>", { noremap = true, silent = true, desc = "Exit insert mode" })
vim.keymap.set("i", "<C-h>", "<Left>", { noremap = true, silent = true, desc = "Move cursor left" })
vim.keymap.set("i", "<C-l>", "<Right>", { noremap = true, silent = true, desc = "Move cursor right" })
vim.keymap.set("i", "<C-k>", "<Up>", { noremap = true, silent = true, desc = "Move cursor up" })
vim.keymap.set("i", "<C-j>", "<Down>", { noremap = true, silent = true, desc = "Move cursor down" })

-- Search
vim.keymap.set("n", "<leader><leader><leader>", "<cmd>nohlsearch<CR>", { noremap = true, silent = true, desc = "Clear search highlight" })

-- Display-line movement
vim.keymap.set("n", "j", "gj", { noremap = true, silent = true, desc = "Move down by display line" })
vim.keymap.set("n", "k", "gk", { noremap = true, silent = true, desc = "Move up by display line" })

-- Window split
vim.keymap.set("n", "ss", "<C-w>s", { noremap = true, silent = true, desc = "Split window horizontally" })
vim.keymap.set("n", "sv", "<C-w>v", { noremap = true, silent = true, desc = "Split window vertically" })

-- Window navigation
vim.keymap.set("n", "sh", "<C-w>h", { noremap = true, silent = true, desc = "Go to the left window" })
vim.keymap.set("n", "sl", "<C-w>l", { noremap = true, silent = true, desc = "Go to the right window" })
