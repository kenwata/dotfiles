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
  -- Hide the tabline and statusline like the startup dashboard does (T144, user decision
  -- 2026-09-17), restoring them the same way snacks' own startup path does in dashboard.lua's
  -- M.setup: on Closed, or when another non-floating window is entered while this one stays.
  local options = { showtabline = vim.o.showtabline, laststatus = vim.o.laststatus }
  vim.o.showtabline, vim.o.laststatus = 0, 0
  local dashboard_buf = vim.api.nvim_create_buf(false, true)
  local dashboard = Snacks.dashboard.open({ win = win, buf = dashboard_buf })
  local restore = vim.schedule_wrap(function()
    local view = vim.fn.winsaveview()
    for name, value in pairs(options) do
      if vim.o[name] == 0 and value ~= 0 then
        vim.o[name] = value
      end
    end
    options = {}
    vim.fn.winrestview(view)
  end)
  vim.api.nvim_create_autocmd("User", {
    group = dashboard.augroup,
    pattern = "SnacksDashboardClosed",
    once = true,
    desc = "Restore tabline/statusline hidden by the dashboard reopen",
    callback = restore,
  })
  vim.api.nvim_create_autocmd("WinEnter", {
    group = dashboard.augroup,
    desc = "Restore tabline/statusline when leaving the reopened dashboard for a normal window",
    callback = function()
      local current = vim.api.nvim_get_current_win()
      if current ~= win and vim.api.nvim_win_get_config(current).relative == "" then
        restore()
      end
    end,
  })
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
          -- U+F07C nf-fa-folder_open, picked on real hardware in T144 (user decision 2026-09-17)
          -- from mini.icons' tree/mini.files glyphs and the Font Awesome folders; this one matches
          -- the Font Awesome family of f/g/n/q above. The line is written by a script, not the
          -- editor tools, because private-use glyphs get dropped there.
          { icon = " ", key = "e", desc = "Explorer", action = "<leader>e" },
          { icon = " ", key = "n", desc = "New File", action = ":ene | startinsert" },
          { icon = "󰒲 ", key = "L", desc = "Lazy", action = ":Lazy" },
          { icon = " ", key = "q", desc = "Quit", action = ":qa" },
        },
        -- Header text (the default NEOVIM logo) and the one-column layout are snacks' defaults,
        -- kept after seeing the alternatives on real hardware in T144 (user decisions 2026-09-17,
        -- docs/design/snacks-dashboard-vimatrix-rain.md "見た目の選定"). Item counts are set per
        -- section below.
      },
      sections = {
        { section = "header" },
        { section = "keys", gap = 1, padding = 1 },
        -- cwd = true scopes Recent Files to v:oldfiles under the launch directory, matching the
        -- per-project feel of the Projects section below rather than a global history.
        -- limit = 8 (snacks' default is 5) for both this and Projects: picked on real hardware in
        -- T144 (user decision 2026-09-17).
        { section = "recent_files", title = "Recent Files", cwd = true, padding = 1, limit = 8 },
        -- The default action (chdir -> try session restore -> Snacks.dashboard.pick("files"))
        -- ends by calling mini.pick directly, bypassing minipick.lua's side-preview/ripgreprc
        -- setup; Snacks.dashboard.pick("oldfiles") has no mini.pick picker to call either. This
        -- action instead chdirs and replays <leader>ff, landing on the same find-files picker
        -- `f` above uses.
        {
          section = "projects",
          title = "Projects",
          padding = 1,
          limit = 8,
          action = function(dir)
            vim.fn.chdir(dir)
            vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes("<leader>ff", true, true, true), "tm", true)
          end,
        },
        { section = "startup" },
      },
    },
    -- 'cursorline' stays off here (snacks' dashboard style default): the current-item marker is a
    -- band limited to the dashboard's text rectangle, drawn by lua/plugins/vimatrix.lua because
    -- it shares that file's rectangle geometry (T144, user decision 2026-09-17).
  },
}
