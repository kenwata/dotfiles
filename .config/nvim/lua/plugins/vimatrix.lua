-- vimatrix.nvim is lazy-loaded via two racing paths (lazy.nvim runs config() once, on
-- whichever path wins; the other is a no-op, loader.lua:198,342):
--
-- 1. event = "VeryLazy": fires after startup on every session, needed so the screensaver
--    (T142) gets armed even when the session never opens the dashboard.
-- 2. init below listens for "User SnacksDashboardOpened" and calls require("lazy").load()
--    itself. event = "User SnacksDashboardOpened" is NOT used here: lazy.nvim re-fires the
--    event after loading a plugin, but drops the pattern and calls
--    nvim_exec_autocmds("User") with no pattern (lazy/core/handler/event.lua:82-90,161-166), so
--    a pattern-matched handler registered inside config() never sees that first firing
--    (verified headless: config() runs, but the handler only fires on a later, second "User"
--    event). init-driven require("lazy").load() is the same pattern lua/plugins/minifiles.lua's
--    BufEnter stub and lua/plugins/minipick.lua's vim.ui.select use for entry points lazy.nvim
--    cannot declare directly (docs/design/snacks-dashboard-vimatrix-rain.md "読み込み方式").
--
-- On a no-argument launch, UIEnter (path 2) runs before VeryLazy (path 1), so path 2 normally
-- wins and Rain can start as soon as the dashboard opens rather than waiting for VeryLazy.

local dashboard_buf = nil ---@type integer?
local dashboard_win = nil ---@type integer?
local last_screen_size = nil ---@type {columns: integer, lines: integer}?

local function screen_size()
  return { columns = vim.o.columns, lines = vim.o.lines }
end

-- Larger than any realistic terminal width, so line * COLUMN_STRIDE + col never collides
-- across rows (docs/design/snacks-dashboard-vimatrix-rain.md "マスク").
local COLUMN_STRIDE = 4096
local occupied = {} ---@type table<integer, true> screen cells (line * COLUMN_STRIDE + col) Rain must not draw over

--- Rebuilds `occupied` from the live dashboard window: every cell outside its rectangle (so Rain
--- stays inside the dashboard window when it isn't fullscreen, e.g. a future split reopen), plus
--- every cell inside it holding a non-whitespace dashboard character. Cheap enough to run on
--- every redraw/layout change since it's called once per change, not once per Rain frame like
--- ignore_cells() itself (docs/design/snacks-dashboard-vimatrix-rain.md "マスク").
local function rebuild_mask()
  local next_occupied = {}
  if dashboard_buf == nil or dashboard_win == nil or not vim.api.nvim_win_is_valid(dashboard_win) then
    occupied = next_occupied
    return
  end

  local win_pos = vim.api.nvim_win_get_position(dashboard_win)
  local win_top, win_left = win_pos[1], win_pos[2]
  local win_bottom = win_top + vim.api.nvim_win_get_height(dashboard_win)
  local win_right = win_left + vim.api.nvim_win_get_width(dashboard_win)
  for screen_line = 1, vim.o.lines do
    for screen_col = 1, vim.o.columns do
      if screen_line <= win_top or screen_line > win_bottom or screen_col <= win_left or screen_col > win_right then
        next_occupied[screen_line * COLUMN_STRIDE + screen_col] = true
      end
    end
  end

  -- Iterate by codepoint (not byte) so multi-byte dashboard glyphs (Nerd Font icons) mask a
  -- single screen cell instead of one per continuation byte; screenpos() takes a byte column.
  for lnum, text in ipairs(vim.api.nvim_buf_get_lines(dashboard_buf, 0, -1, false)) do
    local char_starts = vim.str_utf_pos(text)
    for i, bytecol in ipairs(char_starts) do
      local char_end = (char_starts[i + 1] or (#text + 1)) - 1
      if not text:sub(bytecol, char_end):match("^%s$") then
        local pos = vim.fn.screenpos(dashboard_win, lnum, bytecol)
        if pos.row > 0 then
          next_occupied[pos.row * COLUMN_STRIDE + pos.col] = true
        end
      end
    end
  end

  occupied = next_occupied
end

--- Starts Rain over the dashboard, guarded against the dashboard buffer having already been
--- wiped (e.g. fast typeahead of `:e file<CR>` right after launch) by the time this runs:
--- open_overlay() below acts on whatever buffer is current, so without this check Rain would
--- start over the opened file instead (docs/design/snacks-dashboard-vimatrix-rain.md "Rain の
--- 開始と停止", "ガードが必須である理由").
local function start_rain()
  if dashboard_buf == nil or vim.api.nvim_get_current_buf() ~= dashboard_buf then
    return
  end
  if vim.bo[dashboard_buf].filetype ~= "snacks_dashboard" then
    return
  end
  last_screen_size = screen_size()
  require("vimatrix.orchestrator").rain({ "VimResized" }, { "<Esc>" })
end

return {
  "wolfwfr/vimatrix.nvim",
  commit = "eea0efca87dde2e83b9a744dc4f93a582586466c",
  lazy = true,
  event = "VeryLazy",
  init = function()
    vim.api.nvim_create_autocmd("User", {
      pattern = "SnacksDashboardOpened",
      desc = "Load vimatrix.nvim and start Rain over the dashboard",
      callback = function()
        dashboard_buf = vim.api.nvim_get_current_buf()
        dashboard_win = vim.api.nvim_get_current_win()
        -- Opened fires after snacks's own D:update() (and the UpdatePost it fires from inside
        -- that) has already drawn this dashboard (dashboard.lua:228-229: self:update() runs
        -- before self.fire("Opened")). The UpdatePost autocmd below only catches later redraws,
        -- so the first mask has to be built here, synchronously, before Rain can start.
        rebuild_mask()
        require("lazy").load({ plugins = { "vimatrix.nvim" } })
        -- SnacksDashboardOpened fires while UIEnter is still being processed (before the first
        -- frame). Deferring past that with vim.schedule lets the dashboard draw first, since
        -- synchronously filling the whole screen with extmarks here would delay it instead
        -- (docs/design/snacks-dashboard-vimatrix-rain.md "vim.schedule で開始する理由"). pty
        -- verification below confirms this doesn't push the dashboard's own draw time later
        -- than before vimatrix existed (T138); a short defer_fn would be the fallback.
        vim.schedule(start_rain)
      end,
    })

    vim.api.nvim_create_autocmd("User", {
      pattern = "SnacksDashboardUpdatePost",
      desc = "Rebuild the Rain mask after the dashboard redraws (e.g. on resize)",
      callback = rebuild_mask,
    })

    vim.api.nvim_create_autocmd({ "WinScrolled", "WinResized" }, {
      desc = "Rebuild the Rain mask when the dashboard window's position or scroll changes",
      callback = rebuild_mask,
    })

    vim.api.nvim_create_autocmd("User", {
      pattern = "SnacksDashboardClosed",
      desc = "Stop Rain when the dashboard buffer is wiped",
      callback = function()
        dashboard_buf = nil
        dashboard_win = nil
        occupied = {}
        -- The dashboard buffer is bufhidden=wipe, so every close path (opening a file, q,
        -- :ene) fires this. VimatrixClose skips setup_cancellation's own undo (no keymap
        -- restore, no VimatrixUndo), but that's fine here because the buffer the <Esc> mapping
        -- was attached to is gone with it either way.
        if package.loaded.vimatrix then
          vim.cmd.VimatrixClose()
        end
      end,
    })

    -- Restarting after a terminal resize is driven by VimatrixUndo (the regular cancellation
    -- path's own cleanup), not by calling VimatrixClose and restarting synchronously:
    -- VimatrixClose stops the ticker and closes the window but skips setup_cancellation's undo
    -- (keymap restore, VimatrixUndo firing), so the buffer-local <Esc> mapping the next rain()
    -- call installs would see the still-present "existing" mapping and wrap it, chaining stale
    -- closures on every resize (docs/design/snacks-dashboard-vimatrix-rain.md "Rain の開始と
    -- 停止").
    vim.api.nvim_create_autocmd("User", {
      pattern = "VimatrixUndo",
      desc = "Restart Rain after a terminal resize; <Esc> cancellation leaves the size unchanged",
      callback = function()
        if dashboard_buf == nil then
          return
        end
        if last_screen_size and vim.deep_equal(last_screen_size, screen_size()) then
          return
        end
        -- window.undo() (called just before this fires) nils its buffer id inside vim.schedule,
        -- so restarting synchronously here would see is_open() still true and silently no-op.
        -- Scheduling queues this after that undo, FIFO
        -- (docs/design/snacks-dashboard-vimatrix-rain.md "リサイズ").
        vim.schedule(start_rain)
      end,
    })
  end,
  config = function()
    -- require("vimatrix").setup() must run before anything requires vimatrix.window or
    -- vimatrix.orchestrator: both bind config.options to a local at require-time, and setup()
    -- replaces M.options with a new table, so a require() before setup() would keep seeing the
    -- defaults forever (docs/design/snacks-dashboard-vimatrix-rain.md "順序制約"). Nothing
    -- above requires either module -- start_rain() only does so inside itself, and is never
    -- called before this setup() has returned.
    require("vimatrix").setup({
      window = {
        by_filetype = {
          snacks_dashboard = {
            background = "", -- let gruvbox's background show through the float
            blend = 100, -- cells with no character stay fully transparent
            border = "none", -- omitting this defaults to 'winborder' and shifts the grid by 1
            zindex = 20, -- above the non-floating dashboard (10), below toggleterm (50)
            -- occupied is rebuilt by rebuild_mask() above, not read here; T144 chooses the mask's
            -- shape (character-only, +1 column padding, or rectangle) by swapping this function.
            ignore_cells = function(_, line, col)
              return occupied[line * COLUMN_STRIDE + col] == true
            end,
          },
        },
      },
      -- README "Recommendation for low-power systems", used as the starting point for T144's
      -- real-hardware tuning rather than the (heavier) plugin defaults
      -- (docs/design/snacks-dashboard-vimatrix-rain.md "性能の方針と計測方法").
      droplet = {
        max_size_offset = 5,
        timings = {
          max_fps = 15,
          fps_variance = 2,
          max_timeout = 200,
        },
        random = {
          body_to_tail = 10,
          head_to_glitch = -1,
          head_to_tail = 20,
          kill_head = 50,
          new_head = 80,
        },
      },
    })
  end,
}
