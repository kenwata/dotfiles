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
--
-- No `cond` gate either. T139 measured a `cond = function() return vim.fn.argc(-1) == 0 end`
-- variant (skips loading snacks -- and the <Leader>d dashboard-reopen key below (T143) with it --
-- for any session started with a file argument) against this always-loaded version. The
-- with-argument startup-time increase over the pre-T138 baseline was smaller for `cond`
-- (+5.027ms, 95% CI [1.419, 7.503]) than for always-loaded (+9.475ms, 95% CI [4.674, 15.539]),
-- but the user judged the difference too small to matter and kept always-loaded
-- (docs/design/snacks-dashboard-vimatrix-rain.md "読み込み方式"; decision recorded 2026-09-17).
-- Reopens the startup dashboard in the current window (used by the <leader>d key below).
-- Non-floating, like the startup path (Snacks.dashboard.open's `win` argument skips creating a
-- float), so <Esc> stays unbound here and doesn't collide with vimatrix's Rain-stop <Esc>
-- (docs/design/snacks-dashboard-vimatrix-rain.md "再表示キー `<Leader>d`"; a floating
-- Snacks.dashboard() was rejected for this reason, see the design's "検討した代替案"). A terminal
-- buffer or a winfixbuf window can't have its buffer swapped like this, so those are refused
-- with a notification instead.
local function reopen_dashboard()
  local win = vim.api.nvim_get_current_win()
  local buf = vim.api.nvim_win_get_buf(win)
  if vim.bo[buf].buftype == "terminal" or vim.wo[win].winfixbuf then
    vim.notify("Can't reopen the dashboard in this window", vim.log.levels.WARN)
    return
  end
  local dashboard_buf = vim.api.nvim_create_buf(false, true)
  Snacks.dashboard.open({ win = win, buf = dashboard_buf })
  -- D:update() (called synchronously inside Snacks.dashboard.open above) binds every `keys`
  -- item, including the "Quit" item ("q" -> ":qa"), as its own buffer-local "q" mapping,
  -- overwriting D:init()'s earlier "q" -> "<cmd>bd<cr>" (dashboard.lua:248,692-694). That's the
  -- desired behavior for the startup dashboard (buf 1: "q" really does mean "quit Neovim", per
  -- the "q"/"Quit" row above), but reopening mid-session must not let "q" close the whole editor
  -- (docs/design/snacks-dashboard-vimatrix-rain.md "再表示キー `<Leader>d`": "`q` で `:bd` され、
  -- ウィンドウは直前のバッファに戻る"). Re-setting "q" here, after open(), targets only this
  -- reopened buffer and leaves the startup dashboard's own "q" untouched.
  vim.keymap.set("n", "q", "<cmd>bd<cr>", { buffer = dashboard_buf, silent = true, desc = "Close dashboard" })
end

return {
  "folke/snacks.nvim",
  version = "2",
  lazy = false,
  -- Registered from startup (lazy = false), same as the dashboard itself, so <leader>d works in
  -- every session including ones started with a file argument. No mini.clue entry is added: `d`
  -- is a leaf key under <leader>, not a group, and mini.clue reads its label straight from this
  -- `desc` the same way it does for <leader>e and <leader>ff (lua/plugins/miniclue.lua only lists
  -- group prefixes).
  keys = {
    { "<leader>d", reopen_dashboard, desc = "Reopen dashboard" },
  },
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
          { icon = " ", key = "f", desc = "Find File", action = "<leader>ff" },
          { icon = " ", key = "g", desc = "Grep", action = "<leader>fg" },
          { icon = " ", key = "e", desc = "Explorer", action = "<leader>e" },
          { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
          { icon = "󰒲 ", key = "L", desc = "Lazy", action = ":Lazy" },
          { icon = " ", key = "q", desc = "Quit", action = ":qa" },
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
