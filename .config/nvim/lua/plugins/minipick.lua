-- rg does not search hidden files/dirs by default; ripgreprc turns that on. Setting
-- RIPGREP_CONFIG_PATH on vim.env for the whole session would leak into every child process
-- (:terminal shells, the claude CLI that claudecode.nvim spawns), since vim.env mutates the
-- Neovim process environment itself. Scoping it to the picker call keeps the effect inside
-- the synchronous MiniPick.start loop that fn runs in.
local function with_ripgreprc(fn)
  local original = vim.env.RIPGREP_CONFIG_PATH
  vim.env.RIPGREP_CONFIG_PATH = vim.fs.joinpath(vim.fn.stdpath("config"), "ripgreprc")
  local ok, err = pcall(fn)
  vim.env.RIPGREP_CONFIG_PATH = original
  if not ok then
    error(err)
  end
end

-- Placement of the picker's own window and the side preview window for <Leader>ff/<Leader>fg/
-- <Leader>fb, computed once per open/resize from these ratios. This is the "既定寄せ"
-- (default-aligned) placeholder pattern from the design doc -- T130 replaces the values below
-- (and, if a differently-anchored pattern is chosen, likely the row/col arithmetic in
-- compute_layout() too) after choosing the look on the real terminal. Until then this is not the
-- visual decision, just a value to build and test against.
local LAYOUT = {
  width_ratio = 0.618, -- combined width of list + preview, as a share of the screen width
  height_ratio = 0.618, -- height of both windows, as a share of the screen height
  anchor = "SW", -- corner the pair is anchored to (mini.pick's own default position)
  list_share = 0.5, -- fraction of the combined width given to the candidate list
  line_position = "top", -- MiniPick.default_preview's line_position for the side window
}

--- Computes where the picker's own window and the side preview window go, from `LAYOUT` and the
--- current screen size. The row/max_height arithmetic mirrors what mini.pick uses for its own
--- default window (`H.picker_compute_win_config` in pick.lua) so the pair anchors to the same
--- corner mini.pick would use unassisted; duplicated here because that helper is private.
---@return table layout Has `list` and `preview` fields, each a floating-window config table.
local function compute_layout()
  local has_tabline = vim.o.showtabline == 2 or (vim.o.showtabline == 1 and #vim.api.nvim_list_tabpages() > 1)
  local has_statusline = vim.o.laststatus > 0
  local max_width = vim.o.columns
  local max_height = vim.o.lines - vim.o.cmdheight - (has_tabline and 1 or 0) - (has_statusline and 1 or 0)
  local row = max_height + (has_tabline and 1 or 0)

  -- Clamped to 1 the same way pick.lua's own H.picker_compute_win_config clamps its window: on a
  -- small enough terminal, an unclamped height/width here would be zero or negative, and
  -- nvim_open_win()/nvim_win_set_config() error on that ("Invalid 'height': expected positive
  -- Integer"). mini.pick clamps its own (list) window after receiving this from window.config,
  -- but nothing downstream does that for the preview window, so it is clamped here directly.
  local total_width = math.floor(LAYOUT.width_ratio * max_width)
  local height = math.max(math.floor(LAYOUT.height_ratio * max_height), 1)
  local list_width = math.max(math.floor(total_width * LAYOUT.list_share), 1)
  local preview_width = math.max(total_width - list_width, 1)
  local border_width = 2 -- the list window's own left + right border columns

  return {
    list = {
      relative = "editor",
      anchor = LAYOUT.anchor,
      row = row,
      col = 0,
      width = list_width,
      height = height,
    },
    preview = {
      relative = "editor",
      anchor = LAYOUT.anchor,
      row = row,
      col = list_width + border_width,
      width = preview_width,
      height = height,
      focusable = false,
      noautocmd = true,
      style = "minimal",
      -- No explicit border: omitting it here, like mini.pick's own window does (pick.lua
      -- H.picker_compute_win_config), lets it inherit the global 'winborder' (set to "rounded" in
      -- lua/config/general.lua) so the two windows' corners match instead of single vs. rounded.
    },
  }
end

--- Turns a picker candidate into a string that changes exactly when the candidate does, so
--- show_with_side_preview can tell "still the same selection" apart from "moved to a new one"
--- without relying on table identity (MiniPick.get_picker_matches() recomputes its result table
--- on every call, so `current` is never the same table twice even for the same candidate).
---@param item any A `<Leader>ff`/`<Leader>fg` candidate (string) or `<Leader>fb` candidate
---   (a table with `text` and `bufnr` fields).
---@return string key
local function item_key(item)
  if type(item) == "table" then
    return tostring(item.bufnr) .. "\0" .. tostring(item.text)
  end
  return tostring(item)
end

-- Side preview window state, mutated only from show_with_side_preview and the MiniPickStop
-- handler below (the closing half of the same lifecycle). `win` is nil whenever no side window
-- is showing; `shown_key` is the item_key() of whatever it currently displays, or the
-- NO_CANDIDATE sentinel when nothing matches (kept distinct from every possible item_key() string
-- so an item that happened to stringify to "" can't be mistaken for "no candidate").
local NO_CANDIDATE = {}
local side = { win = nil, shown_key = nil }

-- Registered once at spec-load time (cheap; does not force-load mini.pick). The VimResized
-- handler that keeps the side window aligned is added to this group only while the window is
-- open, and cleared from it when the window closes.
local side_resize_group = vim.api.nvim_create_augroup("minipick_side_preview_resize", { clear = true })

--- Opens the side preview window with a throwaway empty buffer (the caller replaces it
--- immediately) and arms the VimResized handler that keeps it aligned with the picker's own
--- window. Only ever called from show_with_side_preview, which is also the only reader of
--- `side.win`, so there is no risk of two side windows existing at once.
---@return integer win_id
local function open_side_window()
  local placeholder_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[placeholder_buf].bufhidden = "wipe"
  local win_id = vim.api.nvim_open_win(placeholder_buf, false, compute_layout().preview)

  vim.api.nvim_create_autocmd("VimResized", {
    group = side_resize_group,
    desc = "Keep the mini.pick side preview aligned with the picker's own window",
    callback = function()
      if vim.api.nvim_win_is_valid(win_id) then
        vim.api.nvim_win_set_config(win_id, compute_layout().preview)
      end
    end,
  })

  return win_id
end

--- Wraps MiniPick.default_show to also keep the side window showing a preview of the currently
--- selected candidate. Passed as `source.show` to the three builtin pickers below (see
--- PICKER_OPTS); every step's ordering matters and is explained in the design doc's "横並び
--- プレビュー" section.
---@param buf_id integer Passed straight through to MiniPick.default_show.
---@param items table Passed straight through to MiniPick.default_show.
---@param query table Passed straight through to MiniPick.default_show.
local function show_with_side_preview(buf_id, items, query)
  local minipick = require("mini.pick")
  minipick.default_show(buf_id, items, query, { show_icons = true })

  local current = minipick.get_picker_matches().current
  local key = current == nil and NO_CANDIDATE or item_key(current)
  if key == side.shown_key then
    return
  end
  side.shown_key = key

  if side.win == nil or not vim.api.nvim_win_is_valid(side.win) then
    side.win = open_side_window()
  end

  local preview_buf = vim.api.nvim_create_buf(false, true)
  vim.bo[preview_buf].bufhidden = "wipe"
  -- default_preview must see its buffer already in a window (H.preview_set_cursor looks the
  -- window up via bufwinid()) to move the cursor to the match and honor line_position.
  vim.api.nvim_win_set_buf(side.win, preview_buf)

  -- nvim_win_set_buf() resets 'scrolloff' (a global-local option) back to the global value
  -- (10, lua/config/general.lua) on every call, so this has to be redone after each swap, not
  -- just once when the window is created. Left at 10, MiniPick.default_preview's closing `zt`
  -- keeps 10 lines above the matched line instead of putting it at the top, making
  -- `line_position` a no-op. mini.pick sets the same pair on its own window for the same reason
  -- (pick.lua H.picker_new_win), but only has to do it once since that window's buffer never
  -- changes via nvim_win_set_buf.
  vim.wo[side.win].scrolloff = 0
  vim.wo[side.win].wrap = false

  if current ~= nil then
    minipick.default_preview(preview_buf, current, { line_position = LAYOUT.line_position })
  end
end

local SCROLL_KEYS = { down = "<C-f>", up = "<C-b>" }

--- Builds the `func` for a scroll_preview_down/scroll_preview_up mapping entry: scrolls the side
--- window while the picker's own window is showing the candidate list, or falls back to
--- scrolling that window itself once `<Tab>` has switched it to a full-window preview (the
--- previous, built-in behavior for that case). `get_picker_state().buffers.preview` can't be used
--- for this check: it keeps its last value once a preview has been shown, even after returning to
--- the list (design doc, `<M-f>`/`<M-b>` section).
---@param direction "down"|"up"
---@return function func Mapping action. Takes and returns nothing: mini.pick calls a custom
---   mapping's `func` with no arguments and only inspects the result for actions literally named
---   `stop` (`H.picker_advance` in pick.lua), which this is not.
local function scroll_preview_action(direction)
  local keys = vim.api.nvim_replace_termcodes(SCROLL_KEYS[direction], true, false, true)
  return function()
    local state = require("mini.pick").get_picker_state()
    if state == nil then
      return
    end

    local showing_list = vim.api.nvim_win_get_buf(state.windows.main) == state.buffers.main
    -- Not `showing_list and side.win or state.windows.main`: when showing_list is true and
    -- side.win is nil (before the first show() has run), Lua's and/or falls through to the else
    -- branch instead of yielding nil, silently scrolling the list window rather than doing
    -- nothing as intended.
    local target_win = state.windows.main
    if showing_list then
      target_win = side.win
    end
    if target_win == nil or not vim.api.nvim_win_is_valid(target_win) then
      return
    end

    vim.api.nvim_win_call(target_win, function()
      vim.cmd("normal! " .. keys)
    end)
  end
end

-- Passed as the second argument to each of the three wrapped builtin pickers below. Not passed to
-- setup(): doing that would also apply the side preview and remapped <M-f>/<M-b> to the
-- vim.ui.select picker, which the design keeps unchanged.
local PICKER_OPTS = {
  source = { show = show_with_side_preview },
  window = {
    config = function()
      return compute_layout().list
    end,
  },
  mappings = {
    -- Disabling first avoids `H.normalize_mappings`' "Duplicating mapping keys" warning: both
    -- scroll_down/up and the custom actions below would otherwise claim the same <M-f>/<M-b>.
    scroll_down = "",
    scroll_up = "",
    scroll_preview_down = { char = "<M-f>", func = scroll_preview_action("down") },
    scroll_preview_up = { char = "<M-b>", func = scroll_preview_action("up") },
  },
}

return {
  "echasnovski/mini.pick",
  version = "0.18",
  -- mini.pick is loaded on first use, not at startup. The three keys below and vim.ui.select
  -- (init, further down) are the entry points that can trigger it before the plugin is on disk.
  keys = {
    {
      "<leader>ff",
      function()
        with_ripgreprc(function()
          require("mini.pick").builtin.files({}, PICKER_OPTS)
        end)
      end,
      desc = "Find files by name, with a side preview",
      silent = true,
    },
    {
      "<leader>fg",
      function()
        with_ripgreprc(function()
          require("mini.pick").builtin.grep_live({}, PICKER_OPTS)
        end)
      end,
      desc = "Search file contents (live grep), with a side preview",
      silent = true,
    },
    -- Not wrapped in with_ripgreprc: this picker lists buffers from :buffers and never spawns rg.
    {
      "<leader>fb",
      function()
        require("mini.pick").builtin.buffers({}, PICKER_OPTS)
      end,
      desc = "Switch to an open file (buffers), with a side preview",
      silent = true,
    },
  },
  init = function()
    -- Forwards to the real MiniPick.ui_select explicitly (not by re-reading vim.ui.select):
    -- once config() below runs setup(), it reassigns vim.ui.select to MiniPick.ui_select
    -- itself, so this wrapper is only ever invoked once, before mini.pick is on disk. Not an
    -- entry point reached through keys, so the load is explicit here.
    vim.ui.select = function(...)
      require("lazy").load({ plugins = { "mini.pick" } })
      return require("mini.pick").ui_select(...)
    end

    -- Closes the side window (if any of the three wrapped pickers opened one) whenever any
    -- picker stops -- <Esc>, <C-q>, choosing an item, or losing focus all fire this event just
    -- before the picker's own window closes. Registered once here rather than per-picker-open:
    -- MiniPickStop also fires for the unwrapped vim.ui.select picker, where side.win is already
    -- nil and this is a no-op.
    vim.api.nvim_create_autocmd("User", {
      pattern = "MiniPickStop",
      desc = "Close the mini.pick side preview and forget what it was showing",
      callback = function()
        vim.api.nvim_clear_autocmds({ group = side_resize_group })
        if side.win ~= nil and vim.api.nvim_win_is_valid(side.win) then
          vim.api.nvim_win_close(side.win, true)
        end
        side.win, side.shown_key = nil, nil
      end,
    })
  end,
  config = function()
    -- Only the mappings below are given; every other mini.pick option stays at its default.
    -- The prompt is not insert mode -- mini.pick reads keys itself and consults this table
    -- alone -- so the Emacs-style insert-mode keys from lua/config/keybind.lua never reach it.
    -- The four below put the ones worth having while typing a query back within reach.
    --
    -- Each action holds exactly one key (H.normalize_mappings keys its table by the resolved
    -- termcode), so naming a key here takes it away from whatever held that action before. The
    -- arrows, <Del> and <BS> are what pay for the four: <C-h> and <BS> are separate keys to
    -- Neovim (byte 8 against the <80>kb special), so this genuinely retires <BS> in the prompt.
    require("mini.pick").setup({
      mappings = {
        caret_left = "<C-b>",
        caret_right = "<C-f>",
        delete_char = "<C-h>",
        delete_char_right = "<C-d>",
        -- Ctrl now edits the query, so scrolling takes the Alt version of the same letter
        -- rather than being dropped: with the preview open (<Tab>) these are how a long file
        -- is read, and long paths in the candidate list need the horizontal pair. Overridden
        -- per-picker for <Leader>ff/<Leader>fg/<Leader>fb above (PICKER_OPTS), so this pair
        -- only still applies to the vim.ui.select picker.
        scroll_down = "<M-f>",
        scroll_up = "<M-b>",
        scroll_left = "<M-h>",
        scroll_right = "<M-l>",
        -- <C-q> as a second way to close the picker, alongside the built-in stop = '<Esc>'.
        -- Not `func = function() return true end`: the loop only treats the keypress as an
        -- abort when the action name is literally 'stop' (mini/pick.lua H.picker_advance), so a
        -- custom action name returning true still stops the loop but leaves MiniPick.start
        -- returning the currently selected item instead of nil. That is invisible to callers
        -- that ignore the return value (builtin.files() etc.) but breaks vim.ui.select: it only
        -- calls on_choice(nil) when the item is nil, so <C-q> would silently drop the callback
        -- instead of cancelling it (measured against <Esc> with a pty harness, 2026-09-10).
        -- Sending the raw <C-c> byte makes the next getcharstr() return nil, which is the same
        -- abort path MiniPick.stop() uses while waiting on getcharstr -- so item ends up nil,
        -- matching <Esc>. `return true` must be omitted or the loop breaks before feedkeys is read.
        stop_alt = { char = "<C-q>", func = function() vim.api.nvim_feedkeys("\3", "t", true) end },
      },
    })
  end,
}
