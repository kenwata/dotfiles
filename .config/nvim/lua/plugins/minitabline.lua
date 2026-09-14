-- mini.tabline is loaded at startup, not on first use: the tabline is part of the very first
-- frame drawn, and unlike a picker or an explorer it has no "first use" a key could stand in
-- for -- it is simply always visible (see .claude/rules/lua.md Plugins section). Loading it
-- later would also push the whole screen down one row at the moment it appeared.
return {
  "echasnovski/mini.tabline",
  version = "0.18",
  lazy = false,
  -- mini.tabline looks for _G.MiniIcons, then nvim-web-devicons, and draws nothing when
  -- neither is present. Depending on mini.icons keeps its config run before this plugin's own
  -- config (lazy.nvim resolves dependencies before the parent's plugin/ and config,
  -- loader.lua:344-363), so _G.MiniIcons already exists by the time mini.tabline draws its
  -- first frame.
  dependencies = { "mini.icons" },
  config = function()
    -- setup() sets showtabline = 2 (always draw the line) and points 'tabline' at
    -- MiniTabline.make_tabline_string(). Neither is negotiable here: showtabline = 1 counts tab
    -- pages rather than buffers, and this config uses no tab pages, so 1 would keep the tabline
    -- hidden forever.
    --
    -- Which buffers get a tab is not decided here: mini.tabline draws every buffer whose
    -- 'buflisted' is true, and the TermOpen autocommand in lua/config/autocmd.lua is what keeps
    -- terminals out of that list.
    --
    -- mini.tabline accepts exactly three options. The two below are written out; the third,
    -- `format` (a function that builds each tab's label), stays at its default. It is left out
    -- of the table rather than written as `format = nil` because a Lua table literal cannot
    -- tell the two apart -- writing nil and omitting the key produce the same table (the same
    -- reason lua/plugins/claudecode.lua omits terminal_cmd).
    require("mini.tabline").setup({
      -- Icons need a provider: mini.tabline looks for _G.MiniIcons, then nvim-web-devicons, and
      -- draws nothing when neither is present. lua/plugins/miniicons.lua loads mini.icons as a
      -- dependency above, before this file's config runs, so _G.MiniIcons already exists by the
      -- time mini.tabline draws its first frame.
      show_icons = true,
      -- Which side the tab page section sits on. Kept at the default; with no tab pages in use
      -- the section never appears.
      tabpage_section = "left",
    })
  end,
}
