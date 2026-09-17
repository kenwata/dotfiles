-- snacks.nvim is loaded at startup, not on first use: the dashboard it draws (opts.dashboard
-- below) is the very first frame Neovim shows on a no-argument launch, so this falls under the
-- same startup-load exception as the colorscheme and the status line (plan.md §6, .claude/rules
-- /lua.md Plugins section).
--
-- No `priority` is set. README's `priority = 1000` targets snacks modules (bigfile, quickfile)
-- that hook BufReadPre and must win a race against other startup plugins; the dashboard instead
-- acts on UIEnter, which runs after every plugin's config() regardless of load order. Loading
-- after gruvbox.nvim (priority 1000) is fine because snacks defines its SnacksDashboard*
-- highlights as `default = true` on UIEnter, so gruvbox's earlier `overrides` are already in
-- place and win (docs/design/snacks-dashboard-vimatrix-rain.md "読み込み方式").
return {
  "folke/snacks.nvim",
  version = "2",
  lazy = false,
  ---@type snacks.Config
  opts = {
    dashboard = {
      preset = {
        -- Replaces the built-in keymap list wholesale: `f`/`g`/`e` route through
        -- `<leader>ff`/`<leader>fg`/`<leader>e` (keymap actions, not
        -- `Snacks.dashboard.pick()`) so the existing mini.pick side-preview windows
        -- (lua/plugins/minipick.lua) and mini.files explorer (lua/plugins/minifiles.lua) handle
        -- them exactly as they do everywhere else, instead of snacks opening a plain, unstyled
        -- mini.pick window of its own.
        keys = {
          { icon = " ", key = "f", desc = "Find File", action = "<leader>ff" },
          { icon = " ", key = "g", desc = "Grep", action = "<leader>fg" },
          { icon = " ", key = "e", desc = "Explorer", action = "<leader>e" },
          { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
          { icon = "󰒲 ", key = "L", desc = "Lazy", action = ":Lazy" },
          { icon = " ", key = "q", desc = "Quit", action = ":qa" },
        },
        -- Header text, layout, and item counts stay at snacks' defaults here; picked on real
        -- hardware in T144 (docs/design/snacks-dashboard-vimatrix-rain.md "見た目の選定").
      },
      sections = {
        { section = "header" },
        { section = "keys", gap = 1, padding = 1 },
        -- cwd = true scopes Recent Files to v:oldfiles under the launch directory, matching the
        -- per-project feel of the Projects section below rather than a global history.
        { section = "recent_files", title = "Recent Files", cwd = true, padding = 1 },
        -- The default action (chdir -> try session restore -> Snacks.dashboard.pick("files"))
        -- ends by calling mini.pick directly, bypassing minipick.lua's side-preview/ripgreprc
        -- setup; Snacks.dashboard.pick("oldfiles") has no mini.pick picker to call either. This
        -- action instead chdirs and replays <leader>ff, landing on the same find-files picker
        -- `f` above uses.
        {
          section = "projects",
          title = "Projects",
          padding = 1,
          action = function(dir)
            vim.fn.chdir(dir)
            vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<leader>ff", true, true, true), "tm", true)
          end,
        },
        { section = "startup" },
      },
    },
  },
}
