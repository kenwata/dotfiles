-- Autocommands, and the one-shot switches that turn on LSP displays Neovim leaves off.

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

-- Terminal buffers start out 'buflisted', so every :terminal and every terminal a plugin opens
-- would join the buffer list. Dropping them is a decision about the buffer list as a whole, not
-- about any one plugin: it also takes terminals out of [b / ]b and out of <Leader>fb
-- (mini.pick's buffer picker), and only then out of the tabline that lua/plugins/minitabline.lua
-- draws. :ls stops listing them; :ls! still does.
vim.api.nvim_create_autocmd("TermOpen", {
  desc = "Keep terminal buffers out of the buffer list",
  callback = function()
    vim.bo.buflisted = false
  end,
})

-- Code lenses are not drawn by default: the server sends them, nothing renders them, and grx
-- (run code lens) has nothing to act on. Enabling once covers every buffer and keeps the
-- lenses current on its own -- the older vim.lsp.codelens.refresh() plus a refresh autocmd is
-- deprecated in favour of this (see :help vim.lsp.codelens.enable()). Servers without
-- codeLensProvider simply produce none.
vim.lsp.codelens.enable(true)

-- Autocompletion is held back while the cursor sits inside an existing word. The menu that
-- opens there offers to overwrite text that is already correct, and taking a candidate by
-- mistake breaks working code. Everywhere else it stays on, including the places a name is
-- genuinely being chosen: a half-typed word, and just after a member separator such as "." or
-- "::" (the "o" flag in 'complete' lets the language server complete from a non-keyword
-- character, see :help 'complete'). 'autocomplete' is global-local, so writing the
-- buffer-local value leaves the global default from config.general untouched.
local function cursor_is_inside_word()
  local col = vim.api.nvim_win_get_cursor(0)[2]
  local following = vim.fn.matchstr(vim.api.nvim_get_current_line(), ".", col)

  return vim.fn.match(following, "\\k") == 0
end

vim.api.nvim_create_autocmd({ "InsertEnter", "CursorMovedI" }, {
  desc = "Hold back autocompletion inside an existing word",
  callback = function()
    local wanted = not cursor_is_inside_word()
    -- Walking the candidate list moves the cursor and so fires this too; rewriting the option
    -- mid-completion is a side effect worth not having.
    if vim.bo.autocomplete ~= wanted then
      vim.bo.autocomplete = wanted
    end
  end,
})
