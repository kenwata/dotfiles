-- Insert mode cursor movement
vim.keymap.set("i", "jj", "<Esc>", { noremap = true, silent = true, desc = "Exit insert mode" })
-- Same finger motion as the insert-mode jj: leave terminal mode and go back to the window
-- that was active before the terminal (a bare <C-\><C-n> would leave the cursor in the
-- terminal window). Like the insert-mode jj, a lone j is held back until the next key or
-- timeoutlen expires.
vim.keymap.set("t", "jj", [[<C-\><C-n><C-w>p]], { noremap = true, silent = true, desc = "Exit terminal mode to previous window" })
-- Emacs-style, replacing an earlier <C-h>/<C-j>/<C-k>/<C-l> set. Dropping those returns
-- <C-h> to backspace and <C-j> to a line break, and stops the completion menu from moving
-- on them: while the popup is open any of <Down>/<Up> walks the candidates, so the old
-- bindings hijacked the menu as a side effect.
-- <C-b> and <C-f> have no default insert-mode binding. <C-n> and <C-p> normally start
-- keyword completion, and keep selecting candidates here because <Down> and <Up> drive the
-- menu identically (measured by accepting with <C-y> and comparing the inserted word).
-- What they give up is opening the menu by hand, which 'autocomplete' makes unnecessary.
vim.keymap.set("i", "<C-b>", "<Left>", { noremap = true, silent = true, desc = "Move cursor left" })
vim.keymap.set("i", "<C-f>", "<Right>", { noremap = true, silent = true, desc = "Move cursor right" })
vim.keymap.set("i", "<C-p>", "<Up>", { noremap = true, silent = true, desc = "Move cursor up" })
vim.keymap.set("i", "<C-n>", "<Down>", { noremap = true, silent = true, desc = "Move cursor down" })

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

-- LSP display toggles
-- Inlay hints stay off by default and are switched on for the moment they are wanted. They
-- render parameter names inline (nvim_create_autocmd(event: "...", opts: {...})), which reads
-- well when an API takes several positional arguments and gets in the way otherwise, since the
-- inserted text pushes the real code right and 'wrap' then folds the line.
vim.keymap.set("n", "<leader>ih", function()
  vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
end, { noremap = true, silent = true, desc = "Toggle inlay hints" })
