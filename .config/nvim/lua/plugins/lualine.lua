-- lualine.nvim is loaded at startup, not on first use: like the tabline and the colorscheme,
-- the status line is part of the very first frame drawn (see .claude/rules/lua.md Plugins
-- section, plan.md phase 16).
--
-- This must load after lua/plugins/gruvbox.lua. The "auto" theme below resolves
-- vim.g.colors_name once, at the moment setup() runs, and falls back to a generated theme if
-- :colorscheme has not run yet. lua/plugins/init.lua's require order enforces this.
vim.cmd.packadd({ args = { "lualine.nvim" }, bang = true })

-- Provisional configuration matching the design's "既定準拠" (default-compliant) pattern.
-- The final section layout, separators, theme, and icon choice are picked by comparing real
-- patterns on screen and confirmed in this file by a later task
-- (docs/design/lualine-startup-statusline.md "実機での選定").
require("lualine").setup({
  options = {
    icons_enabled = true,
    theme = "auto",
    -- Explicit even though it already follows from vim.o.laststatus = 3
    -- (lua/config/general.lua): this is the setting that keeps a single status line across
    -- splits rather than one per window.
    globalstatus = true,
  },
  sections = {
    lualine_a = { "mode" },
    lualine_b = { "branch", "diff", "diagnostics" },
    lualine_c = { { "filename", path = 1 } },
    lualine_x = { "encoding", "fileformat", "filetype" },
    lualine_y = { "progress" },
    lualine_z = { "location" },
  },
})
