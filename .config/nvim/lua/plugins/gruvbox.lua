-- gruvbox.nvim is loaded at startup, not on first use: a colorscheme affects the very first
-- frame drawn, so deferring it would show Neovim's default colors until something triggered
-- the load (see .claude/rules/lua.md Plugins section).
--
-- The four statements below must stay in this order. packadd puts the plugin on
-- runtimepath, which require() and :colorscheme both need. background is read by gruvbox at
-- the moment it builds its palette, and setup() must run before :colorscheme, which is what
-- actually applies the highlights.
vim.cmd.packadd({ args = { "gruvbox.nvim" }, bang = true })

-- vim.o.termguicolors is deliberately not set here: gruvbox's load() sets it unconditionally.
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
  overrides = {},
  dim_inactive = false,
  transparent_mode = false,
})

vim.cmd.colorscheme("gruvbox")
