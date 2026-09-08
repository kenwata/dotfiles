-- Autocommands live here.

-- Flash the yanked region so it is clear what was copied.
-- DiffText rather than the Search group whose colour it borrows: Search is defined with
-- reverse=true, and reversing paints nothing where listchars draws a space as "·", because
-- the Whitespace group covering that cell carries no background to swap. DiffText holds the
-- same yellow as a real background, so spaces inside the region light up too.
local YANK_FLASH_MS = 300

vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight the yanked region",
  callback = function()
    vim.hl.on_yank({ higroup = "DiffText", timeout = YANK_FLASH_MS })
  end,
})
