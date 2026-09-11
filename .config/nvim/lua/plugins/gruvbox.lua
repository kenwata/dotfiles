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

-- Colours for the overrides further down are taken from gruvbox's own exported palette rather
-- than written as hex literals, so they keep following the colorscheme's definition of "green".
local palette = require("gruvbox").palette

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
    -- mini.tabline links both MiniTablineCurrent and MiniTablineVisible to TabLineSel, so the
    -- buffer being edited and a buffer merely shown in another split are drawn identically.
    -- Splitting them: the current tab reverses into a solid green block, and "visible" keeps
    -- what the current tab used to look like -- green text on the ordinary tab background.
    -- The block also gives the current tab a visible edge against its neighbours.
    MiniTablineCurrent = { fg = palette.dark0, bg = palette.bright_green, bold = true },
    MiniTablineVisible = { fg = palette.bright_green, bg = palette.dark1 },
    -- The modified variants link to StatusLine / StatusLineNC by default, which in this
    -- colorscheme are pale bars (#ebdbb2 and #a89984). With laststatus = 3 the status line sits
    -- one row below the tabline, so an unsaved tab read as an echo of it. Yellow moves the hue
    -- away from the status line while still reading as "needs attention".
    MiniTablineModifiedCurrent = { fg = palette.dark0, bg = palette.bright_yellow, bold = true },
    MiniTablineModifiedVisible = { fg = palette.bright_yellow, bg = palette.dark1 },
    MiniTablineModifiedHidden = { fg = palette.neutral_yellow, bg = palette.dark1 },
    -- nvim-surround marks the text about to be surrounded with NvimSurroundHighlight, which it
    -- links to Visual by default. Visual's bg3 sits at a 1.8:1 contrast against CursorLine's bg1
    -- (measured 2026-09-11), so a single highlighted word was barely distinguishable from the
    -- cursor line. Search is this colorscheme's own "this range, right now" treatment (yellow
    -- block, 6.8:1). Defining it here works because the plugin uses `highlight default link`,
    -- which yields to a group that already exists when the plugin is loaded.
    NvimSurroundHighlight = { link = "Search" },
  },
  dim_inactive = false,
  transparent_mode = false,
})

vim.cmd.colorscheme("gruvbox")
