-- mini.icons is loaded at startup, not on first use: mini.tabline draws on the very first
-- frame and looks for _G.MiniIcons at that moment (show_icons = true in
-- lua/plugins/minitabline.lua). Loading mini.icons later would leave the tabline's first draw
-- without a provider and shift its layout once mini.icons showed up (see .claude/rules/lua.md
-- Plugins section, plan.md phase 14).
vim.cmd.packadd({ args = { "mini.icons" }, bang = true })

-- mini.icons itself draws nothing; it only answers "what glyph and highlight group for this
-- file/extension/filetype/directory/lsp-kind/os". mini.pick and mini.files already look for
-- _G.MiniIcons, so setup() alone makes their generic single-character icons become per-type
-- glyphs, with no change needed in either plugin's own config.
--
-- style is the only option written out. mini.icons accepts five more (default, filetype,
-- extension, file, directory, lsp, os -- per-category overrides of the built-in icon table);
-- none are set here, so every category keeps mini.icons' own defaults.
require("mini.icons").setup({
  -- "glyph" (Nerd Font icons) over "ascii" (plain-text markers): the terminal (Ghostty) has
  -- HackGen Console NF configured, and ascii would waste the font's glyph coverage (user
  -- decision 2026-09-09).
  style = "glyph",
})

-- lualine.nvim looks only for nvim-web-devicons, never mini.icons directly
-- (lualine.nvim's lua/lualine/components/filetype.lua). This registers a fake
-- nvim-web-devicons module backed by mini.icons so lualine's filetype icon renders through
-- the same provider as everything else, rather than adding a second icon plugin
-- (docs/design/lualine-startup-statusline.md "アイコンの供給元"). Placed here, not in
-- lua/plugins/lualine.lua, because the bridging is mini.icons' own feature -- this keeps
-- "who supplies icons" readable from a single file. Cannot be undone once called in a
-- session, so it runs unconditionally at startup rather than being gated on anything.
require("mini.icons").mock_nvim_web_devicons()
