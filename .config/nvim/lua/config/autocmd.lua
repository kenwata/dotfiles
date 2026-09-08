-- Autocommands live here.

-- Flash the yanked region so it is clear what was copied.
-- DiffText rather than Search, though both carry the same yellow #fabd2f in this colorscheme:
-- Search defines it as a foreground with reverse=true, and where listchars draws a space as
-- "·" that cell is painted by Whitespace, which has a foreground only. Reversing there swaps
-- in Whitespace's grey instead of the yellow, so spaces stayed unlit -- observed on screen.
-- DiffText carries the yellow as an actual background, which covers spaces as well.
-- 300ms rather than the 150 default of vim.hl.on_yank: at 150 the flash was easy to miss.
-- The value matches the example in :help vim.hl.on_yank().
local YANK_FLASH_MS = 300

vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight the yanked region",
  callback = function()
    vim.hl.on_yank({ higroup = "DiffText", timeout = YANK_FLASH_MS })
  end,
})
