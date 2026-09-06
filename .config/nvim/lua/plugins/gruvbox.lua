-- gruvbox.nvim is loaded at startup, not on first use: a colorscheme affects the very first
-- frame drawn, so deferring it would show Neovim's default colors until something triggered
-- the load (see .claude/rules/lua.md Plugins section).
--
-- The four statements below must stay in this order. packadd puts the plugin on
-- runtimepath, which require() and :colorscheme both need. background is read by gruvbox at
-- the moment it builds its palette, and setup() must run before :colorscheme, which is what
-- actually applies the highlights.
vim.cmd.packadd({ args = { "gruvbox.nvim" }, bang = true })

-- vim.o.termguicolors is deliberately not set anywhere in this config: gruvbox's load() sets it
-- unconditionally, and Neovim enables it on its own when the terminal supports 24-bit color.

vim.o.background = "dark"

-- Every option gruvbox.nvim accepts is listed, including the ones left at their default, so
-- that the file records a choice rather than an omission.
require("gruvbox").setup({
  terminal_colors = true,
  undercurl = true,
  underline = true,
  bold = true,
  italic = {
    strings = true,
    emphasis = true,
    comments = true,
    operators = false,
    folds = true,
  },
  strikethrough = true,
  invert_selection = false,
  invert_signs = false,
  invert_tabline = false,
  inverse = true,
  contrast = "",
  palette_overrides = {},
  -- mini.pick links its current-item highlight to CursorLine, which gruvbox paints the same
  -- #3c3836 as NormalFloat. That leaves the selected entry indistinguishable from the rest of
  -- the picker. PmenuSel is this colorscheme's own treatment for the selected entry of a list,
  -- so the picker borrows it and keeps following the colorscheme if it ever changes.
  overrides = {
    MiniPickMatchCurrent = { link = "PmenuSel" },
  },
  dim_inactive = false,
  transparent_mode = false,
})

vim.cmd.colorscheme("gruvbox")
