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

---@class DashboardArea screen rectangle (1-based, inclusive) around the dashboard text
---@field top integer
---@field bottom integer
---@field left integer
---@field right integer

-- The dashboard text's bounding box plus 1 row above/below and 2 columns left/right. Rain inside
-- it is drawn dimmed and the current-item band spans exactly its columns. The second column
-- matters: the first one beside a character is already masked (see rebuild_mask), so with a
-- single column most rows showed no dimmed margin at all (measured 20-22 of 41 rows).
local area = nil ---@type DashboardArea?

-- Share of the original Rain colour kept inside `area`, the rest mixed toward Normal's background.
local DIM_KEEP_PERCENT = 25

--- Rebuilds `occupied` and `area` from the live dashboard window. `occupied` holds every cell
--- outside the window's rectangle (so Rain stays inside the dashboard window when it isn't
--- fullscreen, e.g. a split reopen) plus each non-whitespace dashboard character and the cell on
--- either side of it, so Rain never runs right next to an icon or a key (T144, user decision
--- 2026-09-17). Cheap enough to run on every redraw/layout change since it's called once per
--- change, not once per Rain frame like ignore_cells() itself
--- (docs/design/snacks-dashboard-vimatrix-rain.md "マスク").
local function rebuild_mask()
  local next_occupied = {}
  area = nil
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

  -- Iterate by codepoint (not byte) so multi-byte dashboard glyphs (Nerd Font icons) count as a
  -- single screen cell instead of one per continuation byte; screenpos() takes a byte column.
  local top, bottom, left, right = math.huge, -math.huge, math.huge, -math.huge
  for lnum, text in ipairs(vim.api.nvim_buf_get_lines(dashboard_buf, 0, -1, false)) do
    local char_starts = vim.str_utf_pos(text)
    for i, bytecol in ipairs(char_starts) do
      local char_end = (char_starts[i + 1] or (#text + 1)) - 1
      if not text:sub(bytecol, char_end):match("^%s$") then
        local pos = vim.fn.screenpos(dashboard_win, lnum, bytecol)
        if pos.row > 0 then
          for screen_col = pos.col - 1, pos.col + 1 do
            next_occupied[pos.row * COLUMN_STRIDE + screen_col] = true
          end
          top, bottom = math.min(top, pos.row), math.max(bottom, pos.row)
          left, right = math.min(left, pos.col), math.max(right, pos.col)
        end
      end
    end
  end
  if top <= bottom then
    area = { top = top - 1, bottom = bottom + 1, left = left - 2, right = right + 2 }
  end

  occupied = next_occupied
end

local BAND_NS = vim.api.nvim_create_namespace("dashboard_current_item_band")

--- Draws the current-item band: CursorLine's highlight on the cursor row, limited to `area`'s
--- columns instead of the whole window (T144, user decision 2026-09-17). Lives in the dashboard
--- buffer only, so no other buffer or window is affected. Rows shorter than the area are filled
--- with an overlay of spaces.
local function paint_band()
  if dashboard_buf == nil or not vim.api.nvim_buf_is_valid(dashboard_buf) then
    return
  end
  vim.api.nvim_buf_clear_namespace(dashboard_buf, BAND_NS, 0, -1)
  if area == nil or dashboard_win == nil or not vim.api.nvim_win_is_valid(dashboard_win) then
    return
  end
  if vim.api.nvim_win_get_buf(dashboard_win) ~= dashboard_buf then
    return
  end

  local win_left = vim.api.nvim_win_get_position(dashboard_win)[2]
  local first_col, last_col = area.left - win_left - 1, area.right - win_left - 1 -- 0-based display columns
  local row = vim.api.nvim_win_get_cursor(dashboard_win)[1] - 1
  local text = vim.api.nvim_buf_get_lines(dashboard_buf, row, row + 1, false)[1] or ""
  local start_byte, end_byte = nil, nil ---@type integer?, integer?
  local display_col = 0
  local char_starts = vim.str_utf_pos(text)
  for i, bytecol in ipairs(char_starts) do
    local char_end = (char_starts[i + 1] or (#text + 1)) - 1
    local width = vim.fn.strdisplaywidth(text:sub(bytecol, char_end))
    if display_col >= first_col and display_col + width - 1 <= last_col then
      start_byte = start_byte or (bytecol - 1)
      end_byte = char_end
    end
    display_col = display_col + width
  end
  if start_byte then
    vim.api.nvim_buf_set_extmark(dashboard_buf, BAND_NS, row, start_byte, { end_col = end_byte, hl_group = "CursorLine", priority = 1 })
  end
  if display_col <= last_col then
    local fill_from = math.max(display_col, first_col)
    vim.api.nvim_buf_set_extmark(dashboard_buf, BAND_NS, row, 0, {
      virt_text = { { (" "):rep(last_col - fill_from + 1), "CursorLine" } },
      virt_text_win_col = fill_from,
      virt_text_pos = "overlay",
      priority = 1,
    })
  end
end

--- Whether Rain is currently open over the dashboard (as opposed to the screensaver over a file).
local function dashboard_rain_open()
  if not package.loaded["vimatrix.window"] then
    return false
  end
  local window = require("vimatrix.window")
  return window.is_open() and dashboard_buf ~= nil and window.old_buffer == dashboard_buf
end

local dim_groups = {} ---@type table<string, string> source group .. band flag -> derived group name

--- Mixes `keep` percent of `fg` with the rest of `bg`, per RGB channel.
---@param fg integer
---@param bg integer
---@param keep integer
---@return integer
local function mix_rgb(fg, bg, keep)
  local mixed = 0
  for _, shift in ipairs({ 16, 8, 0 }) do
    local unit = 2 ^ shift
    local fg_channel = math.floor(fg / unit) % 256
    local bg_channel = math.floor(bg / unit) % 256
    mixed = mixed + math.floor(fg_channel * keep / 100 + bg_channel * (100 - keep) / 100 + 0.5) * unit
  end
  return mixed
end

--- Returns (defining it on first use) a dimmed copy of one of vimatrix's droplet groups. `blend`
--- is copied from the source (vimatrix's highlight_props sets 1): without it the Rain window's
--- winblend 100 mixes the colour toward grey instead of darkening it. On the band row the
--- background is CursorLine's, since Rain glyphs otherwise carry Normal's background and cut
--- gaps into the band.
---@param ns integer vimatrix's highlight namespace, applied to its window
---@param group string
---@param on_band boolean
---@return string
local function dim_group(ns, group, on_band)
  local key = group .. (on_band and ":band" or "")
  if dim_groups[key] then
    return dim_groups[key]
  end
  local source = vim.api.nvim_get_hl(ns, { name = group })
  local background = vim.api.nvim_get_hl(0, { name = "Normal" }).bg or 0
  local name = "DashboardRainDim" .. group .. (on_band and "Band" or "")
  vim.api.nvim_set_hl(ns, name, {
    fg = source.fg and mix_rgb(source.fg, background, DIM_KEEP_PERCENT) or nil,
    bg = on_band and vim.api.nvim_get_hl(0, { name = "CursorLine", link = false }).bg or nil,
    bold = source.bold,
    blend = source.blend,
  })
  dim_groups[key] = name
  return name
end

local DIM_NS = vim.api.nvim_create_namespace("dashboard_rain_dim")
local band_screen_row = nil ---@type integer?

--- Decoration provider callbacks that repaint Rain glyphs inside `area` with dimmed colours
--- (T144, user decision 2026-09-17: "the rectangle only, a little transparent"). vimatrix can
--- only draw or skip a cell (ignore_cells returns a boolean), and a semi-transparent float
--- above the Rain was measured to hide most glyphs and wash the rest to grey, so each visible
--- glyph is overdrawn at the same window column with an ephemeral, higher-priority overlay.
--- vimatrix itself is not modified.
local dim_provider = {
  on_win = function(_, winid)
    if area == nil or not dashboard_rain_open() or winid ~= require("vimatrix.window").winid then
      return false
    end
    band_screen_row = nil
    if dashboard_win and vim.api.nvim_win_is_valid(dashboard_win) and vim.api.nvim_win_get_buf(dashboard_win) == dashboard_buf then
      local cursor = vim.api.nvim_win_get_cursor(dashboard_win)
      local pos = vim.fn.screenpos(dashboard_win, cursor[1], 1)
      band_screen_row = pos.row > 0 and pos.row or nil
    end
    return true
  end,
  on_line = function(_, _, bufnr, row)
    local screen_row = row + 1 -- the Rain float covers the editor from (0, 0)
    if area == nil or screen_row < area.top or screen_row > area.bottom then
      return
    end
    local ns = require("vimatrix.colours.provider").ns_id
    for _, mark in ipairs(vim.api.nvim_buf_get_extmarks(bufnr, ns, { row, 0 }, { row, -1 }, { details = true })) do
      local details = mark[4]
      local chunk = details.virt_text and details.virt_text[1]
      local win_col = details.virt_text_win_col
      -- vimatrix erases a droplet's tail by writing a highlighted space, which carries Normal's
      -- background: skipped elsewhere (invisible), but on the band row it punched 1-cell holes
      -- into the band, so it is repainted there too.
      local on_band = screen_row == band_screen_row
      if chunk and win_col and chunk[2] and chunk[2] ~= "" and (chunk[1] ~= " " or on_band) then
        local screen_col = win_col + 1
        if screen_col >= area.left and screen_col <= area.right then
          vim.api.nvim_buf_set_extmark(bufnr, DIM_NS, row, 0, {
            virt_text = { { chunk[1], dim_group(ns, chunk[2], on_band) } },
            virt_text_win_col = win_col,
            virt_text_pos = "overlay",
            priority = 10000,
            ephemeral = true,
          })
        end
      end
    end
  end,
}

-- Screen rectangles of every other visible float, refreshed at most every FLOAT_RECTS_TTL_MS
-- because ignore_cells() runs once per printed cell per frame.
local FLOAT_RECTS_TTL_MS = 100
local float_rects = {} ---@type DashboardArea[]
local float_rects_at = 0

--- Whether a screen cell lies under (or 1 cell around) another float such as mini.files or a
--- mini.pick window. Rain keeps running behind them but skips these cells: rewriting a cell under
--- the right half of a wide character in a float above makes the compositor redraw that
--- character as a blank for a frame, which flickered Japanese text in previews (measured 386
--- changed cells over 15 samples before, 0 after; T144, user decision 2026-09-17). The 1-cell
--- margin covers borders and wide characters touching the edge.
---@param line integer
---@param col integer
---@return boolean
local function under_other_float(line, col)
  local now = vim.uv.now()
  if now - float_rects_at >= FLOAT_RECTS_TTL_MS then
    local rain_win = require("vimatrix.window").winid
    local rects = {}
    for _, win in ipairs(vim.api.nvim_list_wins()) do
      local config = vim.api.nvim_win_get_config(win)
      if win ~= rain_win and config.relative ~= "" and not config.hide then
        local pos = vim.api.nvim_win_get_position(win)
        rects[#rects + 1] = {
          top = pos[1],
          bottom = pos[1] + vim.api.nvim_win_get_height(win) + 2,
          left = pos[2],
          right = pos[2] + vim.api.nvim_win_get_width(win) + 2,
        }
      end
    end
    float_rects, float_rects_at = rects, now
  end
  for _, rect in ipairs(float_rects) do
    if line >= rect.top and line <= rect.bottom and col >= rect.left and col <= rect.right then
      return true
    end
  end
  return false
end

--- Shows the cursor while dashboard Rain runs but the user is elsewhere: another window (e.g.
--- mini.files) or the command line. vimatrix hides the cursor for the whole session while Rain
--- is open (Cursor blend 100 plus "a:Cursor" in guicursor), which left no visible cursor there.
--- Back on the dashboard it is hidden again. The screensaver over a file is left to vimatrix.
local function sync_cursor_visibility()
  if not dashboard_rain_open() then
    return
  end
  local away = vim.api.nvim_get_current_win() ~= dashboard_win or vim.fn.mode() == "c"
  local cursor = vim.api.nvim_get_hl(0, { name = "Cursor" })
  cursor.blend = away and 0 or 100
  vim.api.nvim_set_hl(0, "Cursor", cursor)
end

local picker_redraw_timer = nil ---@type uv_timer_t?

--- Keeps dashboard Rain moving while a mini.pick picker is open. mini.pick waits for input with
--- getcharstr(), during which Neovim does not redraw non-picker changes (mini/pick.lua's own
--- note), so Rain looked frozen. Redraws at Rain's frame rate until the picker closes
--- (T144, user decision 2026-09-17). under_other_float() keeps the picker windows flicker-free.
local function start_picker_redraw()
  if not dashboard_rain_open() then
    return
  end
  picker_redraw_timer = picker_redraw_timer or vim.uv.new_timer()
  local interval = math.floor(1000 / require("vimatrix.config").options.droplet.timings.max_fps)
  picker_redraw_timer:start(
    interval,
    interval,
    vim.schedule_wrap(function()
      if package.loaded["mini.pick"] and MiniPick.is_picker_active() and dashboard_rain_open() then
        vim.cmd.redraw()
      elseif picker_redraw_timer then
        picker_redraw_timer:stop()
      end
    end)
  )
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
  dim_groups = {} -- vimatrix redefines its droplet groups on every start
  require("vimatrix.orchestrator").rain({ "VimResized" }, { "<Esc>" })
end

return {
  "wolfwfr/vimatrix.nvim",
  commit = "eea0efca87dde2e83b9a744dc4f93a582586466c",
  lazy = true,
  event = "VeryLazy",
  init = function()
    vim.api.nvim_set_decoration_provider(DIM_NS, dim_provider)

    vim.api.nvim_create_autocmd("CursorMoved", {
      desc = "Move the dashboard's current-item band with the cursor",
      callback = function(ev)
        if ev.buf == dashboard_buf then
          -- Scheduled: snacks' own buffer-local CursorMoved handler snaps the cursor onto the
          -- nearest item after this one runs, so painting synchronously would mark the pre-snap
          -- row (the band vanished after `j` in the UI-attached check).
          vim.schedule(paint_band)
        end
      end,
    })

    vim.api.nvim_create_autocmd({ "WinEnter", "BufEnter", "CmdlineEnter", "CmdlineLeave" }, {
      desc = "Show the cursor away from the dashboard while its Rain runs; hide it on return",
      callback = function()
        vim.schedule(sync_cursor_visibility)
      end,
    })

    vim.api.nvim_create_autocmd("User", {
      pattern = { "MiniPickStart", "MiniPickStop" },
      desc = "Keep dashboard Rain moving while a mini.pick picker blocks redraws",
      callback = function(ev)
        if picker_redraw_timer then
          picker_redraw_timer:stop()
        end
        if ev.match == "MiniPickStart" then
          start_picker_redraw()
        end
      end,
    })

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
        paint_band()
        require("lazy").load({ plugins = { "vimatrix.nvim" } })
        -- SnacksDashboardOpened fires while UIEnter is still being processed (before the first
        -- frame). Deferring past that with vim.schedule lets the dashboard draw first, since
        -- synchronously filling the whole screen with extmarks here would delay it instead
        -- (docs/design/snacks-dashboard-vimatrix-rain.md "vim.schedule で開始する理由"). In the
        -- T140 pty measurement (8 runs each, no interval) the header appeared at a median of
        -- 199.95ms vs 191.4ms before vimatrix (T138); that was judged not a real delay, so a
        -- short defer_fn, the fallback, was not adopted.
        vim.schedule(start_rain)
      end,
    })

    vim.api.nvim_create_autocmd("User", {
      pattern = "SnacksDashboardUpdatePost",
      desc = "Rebuild the Rain mask and the current-item band after the dashboard redraws (e.g. on resize)",
      callback = function()
        rebuild_mask()
        paint_band()
      end,
    })

    vim.api.nvim_create_autocmd({ "WinScrolled", "WinResized" }, {
      desc = "Rebuild the Rain mask when the dashboard window's position or scroll changes",
      callback = function()
        rebuild_mask()
        paint_band()
      end,
    })

    vim.api.nvim_create_autocmd("User", {
      pattern = "SnacksDashboardClosed",
      desc = "Stop Rain when the dashboard buffer is wiped",
      callback = function()
        dashboard_buf = nil
        dashboard_win = nil
        occupied = {}
        area = nil
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
      auto_activation = {
        screensaver = {
          -- 10 minutes of no input starts the Rain screensaver even during normal editing, not
          -- just while the dashboard is shown (user decision 2026-09-17). The other 4 fields
          -- (setup_deferral, ignore_focus, block_on_term, block_on_cmd_line) stay at plugin
          -- defaults (docs/design/snacks-dashboard-vimatrix-rain.md "スクリーンセーバー").
          -- The timer only starts after the first activity (CursorMoved etc.) in the session --
          -- an untouched session never triggers it. block_on_term checks *mode* (t/nt), so a
          -- visible terminal split does not block the timer as long as the cursor is in a normal
          -- buffer. FocusLost pauses the timer and FocusGained resumes it; confirmed Ghostty
          -- delivers FocusLost by switching apps while watching an autocmd-written marker file.
          timeout = 600,
        },
      },
      window = {
        by_filetype = {
          snacks_dashboard = {
            background = "", -- let gruvbox's background show through the float
            blend = 100, -- cells with no character stay fully transparent
            border = "none", -- omitting this defaults to 'winborder' and shifts the grid by 1
            zindex = 20, -- above the floating dashboard (10), below toggleterm (50)
            -- occupied is rebuilt by rebuild_mask() above; under_other_float() keeps Rain from
            -- rewriting cells beneath mini.files/mini.pick windows.
            ignore_cells = function(_, line, col)
              return occupied[line * COLUMN_STRIDE + col] == true or under_other_float(line, col)
            end,
          },
        },
      },
      -- Picked on real hardware in T144 (docs/design/snacks-dashboard-vimatrix-rain.md "見た目の
      -- 選定", user decisions 2026-09-17): the built-in "green" scheme rather than "matrix" or a
      -- gruvbox-derived one, and half-width katakana + digits + symbols + upper-case latin +
      -- binary as the glyph pool. built_in is a list, so tbl_deep_extend replaces the plugin's
      -- default list instead of appending to it.
      colourscheme = "green",
      alphabet = {
        built_in = { "katakana", "decimal", "symbols", "latin_upper", "binary" },
      },
      -- README "Recommendation for low-power systems" was the starting point for T138-T143; T144
      -- chose the plugin defaults (25 fps, glitches on) on real hardware instead, so the block is
      -- kept here disabled rather than deleted
      -- (docs/design/snacks-dashboard-vimatrix-rain.md "性能の方針と計測方法").
      -- droplet = {
      --   max_size_offset = 5,
      --   timings = {
      --     max_fps = 15,
      --     fps_variance = 2,
      --     max_timeout = 200,
      --   },
      --   random = {
      --     body_to_tail = 10,
      --     head_to_glitch = -1,
      --     head_to_tail = 20,
      --     kill_head = 50,
      --     new_head = 80,
      --   },
      -- },
    })
  end,
}
