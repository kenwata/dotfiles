-- lualine.nvim is loaded at startup, not on first use: like the tabline and the colorscheme,
-- the status line is part of the very first frame drawn (see .claude/rules/lua.md Plugins
-- section, plan.md phase 16).
--
-- This must load after lua/plugins/gruvbox.lua: require("gruvbox") below fails until
-- gruvbox.lua's own packadd has put gruvbox.nvim on runtimepath (verified empirically --
-- require("gruvbox") errors "module not found" without it, even with the theme below never
-- reading vim.g.colors_name the way the "auto" theme would have).
vim.cmd.packadd({ args = { "lualine.nvim" }, bang = true })

local palette = require("gruvbox").palette

-- Custom theme, picked on real hardware over the bundled gruvbox theme
-- (docs/design/lualine-startup-statusline.md "実機での選定"). Reuses gruvbox_dark's own b/c
-- colors and inactive state verbatim (lualine.nvim's lua/lualine/themes/gruvbox_dark.lua),
-- replacing only each mode's `a` section background: mini.tabline's current-tab highlight is
-- already a solid bright_green fill (lua/plugins/gruvbox.lua's MiniTablineCurrent), so a green
-- mode block would read as the same colored chunk repeated one line below it.
local theme = {
  normal = {
    a = { bg = palette.bright_blue, fg = palette.dark0, gui = "bold" },
    b = { bg = palette.dark2, fg = palette.light1 },
    c = { bg = palette.dark1, fg = palette.light4 },
  },
  insert = {
    a = { bg = palette.bright_aqua, fg = palette.dark0, gui = "bold" },
    b = { bg = palette.dark2, fg = palette.light1 },
    c = { bg = palette.dark2, fg = palette.light1 },
  },
  visual = {
    a = { bg = palette.bright_purple, fg = palette.dark0, gui = "bold" },
    b = { bg = palette.dark2, fg = palette.light1 },
    c = { bg = palette.dark4, fg = palette.dark0 },
  },
  replace = {
    a = { bg = palette.bright_red, fg = palette.dark0, gui = "bold" },
    b = { bg = palette.dark2, fg = palette.light1 },
    c = { bg = palette.dark0, fg = palette.light1 },
  },
  command = {
    a = { bg = palette.bright_yellow, fg = palette.dark0, gui = "bold" },
    b = { bg = palette.dark2, fg = palette.light1 },
    c = { bg = palette.dark4, fg = palette.dark0 },
  },
  inactive = {
    a = { bg = palette.dark1, fg = palette.light4, gui = "bold" },
    b = { bg = palette.dark1, fg = palette.light4 },
    c = { bg = palette.dark1, fg = palette.light4 },
  },
}

-- U+E0B0 (left) / U+E0B2 (right), the same glyphs lualine.nvim itself uses for
-- section_separators by default (lua/lualine/config.lua:14). Built with nr2char rather than
-- written as literal characters: private-use-area glyphs written through this session's
-- editing tools were observed to come out as empty strings (docs/decisions.md 2026-09-10
-- 「フェーズ 16 の訂正」row), so nr2char builds the character at runtime instead.
local powerline_separator = { left = vim.fn.nr2char(0xE0B0), right = vim.fn.nr2char(0xE0B2) }

-- Every option lualine.nvim accepts is listed, including the ones left at their default, so
-- that this file records a choice rather than an omission (same convention as
-- lua/plugins/gruvbox.lua).
require("lualine").setup({
  options = {
    icons_enabled = true,
    theme = theme,
    component_separators = powerline_separator,
    section_separators = powerline_separator,
    -- Single status line across splits rather than one per window. Already the effective
    -- default here (lualine reads vim.o.laststatus, set to 3 in lua/config/general.lua), but
    -- written out on principle.
    globalstatus = true,
    always_divide_middle = true,
    disabled_filetypes = { statusline = {}, winbar = {} },
    ignore_focus = {},
    always_show_tabline = true,
    refresh = {
      statusline = 1000,
      -- tabline and winbar never redraw on a timer in this config: both stay empty below, and
      -- lualine only starts their timers when either is non-empty
      -- (lualine.lua:468-472,595-599). Written out anyway so the table records every key
      -- lualine accepts.
      tabline = 1000,
      winbar = 1000,
      refresh_time = 16,
      events = {
        "WinEnter",
        "BufEnter",
        "BufWritePost",
        "SessionLoadPost",
        "FileChangedShellPost",
        "VimResized",
        "Filetype",
        "CursorMoved",
        "CursorMovedI",
        "ModeChanged",
      },
    },
  },
  sections = {
    lualine_a = { "mode" },
    lualine_b = { "branch", "diff" },
    lualine_c = { { "filename", path = 1 }, "lsp_status" },
    lualine_x = {
      -- coc.nvim is not installed; narrowed from lualine's default {"nvim_diagnostic", "coc"}
      -- (docs/design/lualine-startup-statusline.md "診断コンポーネントの取得元").
      { "diagnostics", sources = { "nvim_diagnostic" } },
      "searchcount",
      "selectioncount",
      "encoding",
      "fileformat",
      "filetype",
    },
    lualine_y = { "progress" },
    lualine_z = { "location" },
  },
  inactive_sections = {},
  -- mini.tabline owns the tab row and lualine's own tabline/winbar stay empty
  -- (docs/design/lualine-startup-statusline.md "非スコープ" / "mini.tabline との共存").
  tabline = {},
  winbar = {},
  inactive_winbar = {},
  -- Give a terminal buffer (toggleterm) and a quickfix/location-list window their own
  -- statusline instead of the sections above, which read oddly there (a raw term:// buffer
  -- name where `filename` expects a file, an empty `diagnostics` count for a list that has
  -- none). Picked on real hardware over leaving extensions empty.
  extensions = { "toggleterm", "quickfix" },
})
