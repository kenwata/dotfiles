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
