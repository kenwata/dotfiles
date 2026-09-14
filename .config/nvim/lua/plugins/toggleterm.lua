-- Highest terminal number reachable with <M-n> from inside a terminal. Nine is simply how many
-- digits there are; nothing in toggleterm caps the count.
local LAST_REACHABLE_TERMINAL = 9

-- How long to wait before restoring Terminal mode after a shell has exited. Neovim leaves
-- Terminal mode on its own as the last step of tearing the job down, and it does so after the
-- callback below has returned -- so a startinsert issued any earlier is simply undone by it.
-- Measured at 20ms: the mode has already dropped to Normal by then, and startinsert sticks.
local EXIT_MODE_RESTORE_DELAY_MS = 20

--- Returns every terminal that currently occupies a window.
---@return table[]
local function open_terminals()
  return vim.tbl_filter(function(term)
    return term:is_open()
  end, require("toggleterm.terminal").get_all(true))
end

--- Puts the cursor back into Terminal mode once the current round of window juggling settles.
---
--- Deferring is what makes it stick: called outright from a mapping's callback, startinsert is
--- undone as that callback returns. The next tick is late enough for that, but not for a shell
--- that has just exited -- hence delay_ms, which callers on that path pass.
---@param delay_ms integer|nil milliseconds to wait; nil waits only for the next tick
local function enter_terminal_mode(delay_ms)
  local function restore()
    if vim.bo.buftype == "terminal" then
      vim.cmd.startinsert()
    end
  end

  if delay_ms == nil then
    vim.schedule(restore)
  else
    vim.defer_fn(restore, delay_ms)
  end
end

--- Swaps `term` into the window the visible terminal already occupies, rather than closing that
--- window and opening a new one -- which empties the terminal area for an instant and flickers.
--- Returns false when there is nothing to swap into, leaving the caller to open normally.
---
--- Reaches into Terminal.window because toggleterm has no API for reusing a window. Keeping that
--- field in step is what the rest of the plugin reads: is_open() answers by checking whether the
--- window still holds the terminal's own buffer, so the terminal being replaced reports itself
--- closed from here on without any bookkeeping of its own. The winbar is re-set because its
--- expression carries the terminal id it was built for, and would otherwise keep marking the
--- previous terminal as the current one.
---@param term table
---@return boolean
local function swap_into_visible_window(term)
  local visible = open_terminals()[1]
  if visible == nil or visible.id == term.id then
    return false
  end

  local window = visible.window
  if window == nil or not vim.api.nvim_win_is_valid(window) then
    return false
  end
  if term.bufnr == nil or not vim.api.nvim_buf_is_valid(term.bufnr) then
    return false
  end

  vim.api.nvim_win_set_buf(window, term.bufnr)
  term.window = window
  vim.api.nvim_set_current_win(window)
  require("toggleterm.ui").set_winbar(term)
  return true
end

--- Brings terminal `id` up on its own, starting it when that number is unused.
---
--- toggleterm opens each terminal in its own split, so opening a second one leaves both visible
--- side by side. Closing the others first turns the terminal area into a single slot whose
--- occupant this swaps -- the winbar above it then reads as the tab bar for that slot.
---@param id integer
local function show_terminal(id)
  local term = require("toggleterm.terminal").get_or_create_term(id)

  if not swap_into_visible_window(term) then
    for _, other in ipairs(open_terminals()) do
      if other.id ~= id then
        other:close()
      end
    end

    -- Reopened rather than focused: focus() only re-points the cursor, and the terminal would be
    -- left in whatever mode it had. Opening before closing the others would spare the flicker
    -- this ordering causes, but Terminal:close() hands focus back to the editor as it goes, and
    -- the startinsert below would then land there -- putting the editor into Insert mode.
    if term:is_open() then
      term:close()
    end
    term:open()
  end

  -- Neither route above lands in Terminal mode on its own: a swapped window keeps whatever mode
  -- it had (Normal mode, when the shell it held has just exited), and open() reaches its own
  -- startinsert only when it reuses an existing buffer.
  enter_terminal_mode()
end

--- Returns the terminal to fall back on when `id` goes away: the next one by number, or the
--- previous one when `id` was the last. Nil when it was the only terminal left.
---@param id integer
---@return table|nil
local function neighbour_terminal(id)
  local previous = nil
  -- get_all() returns them sorted by id, so the first one past `id` is the next tab along.
  for _, term in ipairs(require("toggleterm.terminal").get_all(true)) do
    if term.id > id then
      return term
    end
    if term.id < id then
      previous = term
    end
  end

  return previous
end

--- Hides the terminal slot, keeping the shells running for the next toggle.
local function hide_terminals()
  for _, term in ipairs(open_terminals()) do
    term:close()
  end
end

--- Names a terminal for the winbar as `<id> <command>` (e.g. `1 zsh`).
---
--- The full path the default formatter prints (`1:/bin/zsh`) is wider than it needs to be for a
--- row that doubles as a tab bar. _display_name() is the only way to reach the name: term.cmd is
--- filled in for custom-command terminals only, and stays nil for the plain shell ones here.
---@param term table
---@return string
local function terminal_winbar_name(term)
  return ("%d %s"):format(term.id, vim.fn.fnamemodify(term:_display_name(), ":t"))
end

return {
  "akinsho/toggleterm.nvim",
  version = "2",
  -- toggleterm is loaded on first use, not at startup: a terminal has no bearing on the first
  -- frame drawn. The repository ships no plugin/ directory, and config() below is what creates
  -- both the commands (:ToggleTerm and seven others) and the mappings, so being on runtimepath
  -- alone does nothing -- which is exactly what makes the key below sufficient as the only
  -- entry point.
  keys = {
    {
      [[<c-\>]],
      -- v:count is read before loading because it does not survive the require: `2<C-\>` has
      -- to reach the second terminal on the very first press too.
      function()
        local count = vim.v.count
        require("lazy").load({ plugins = { "toggleterm.nvim" } })

        if count > 0 then
          show_terminal(count)
        elseif #open_terminals() > 0 then
          hide_terminals()
        else
          -- No count and nothing on screen: reopen whichever terminal was used last, or start
          -- the first one. get_last_focused() returns nil until a terminal has been focused at
          -- least once.
          local last = require("toggleterm.terminal").get_last_focused()
          show_terminal(last and last.id or 1)
        end
      end,
      desc = "Toggle the terminal",
      silent = true,
    },
  },
  config = function()
    -- Only the options this config actually decides are written out. The rest keep their
    -- defaults: start_in_insert, persist_size, shade_terminals, auto_scroll, hide_numbers,
    -- autochdir, clear_env, shell, float_opts and responsiveness.
    require("toggleterm").setup({
      -- open_mapping is deliberately left unset. It would bind <Cmd>ToggleTerm<CR>, which opens a
      -- terminal alongside any already on screen; the keys entry above routes the only entry
      -- point through show_terminal() so that exactly one terminal is ever visible.
      --
      -- Horizontal keeps the terminal clear of claudecode.nvim, which puts its own terminal in a
      -- vertical split on the right (lua/plugins/claudecode.lua).
      direction = "horizontal",
      size = 12,
      -- Off, against its default: it restores the mode each terminal was left in, and a terminal
      -- is always left in Normal mode when <M-n> hops away from it. Restoring that on the way back
      -- would strand the cursor outside Terminal mode, where <M-n> no longer fires. With this off,
      -- start_in_insert applies on every open and every hop lands ready to type.
      persist_mode = false,
      -- The tabline never lists terminals -- the TermOpen autocommand in lua/config/autocmd.lua
      -- clears their 'buflisted' -- so without this there is nothing on screen saying which
      -- terminals exist. Since only one is visible at a time, this row is what makes the others
      -- discoverable: it lists every terminal, marks the visible one, and each entry is clickable.
      winbar = {
        enabled = true,
        name_formatter = terminal_winbar_name,
      },
      -- Off, against its default: it closes the window the moment a shell exits, and reopening it
      -- for the neighbour is visible as a flicker. Leaving the window standing lets on_exit below
      -- swap the neighbour into it with nothing to redraw.
      close_on_exit = false,
      -- Exiting a shell (`exit`, or Ctrl-D) would otherwise take the whole terminal area with it
      -- and drop the cursor back in the editor, even with other terminals still running. Showing
      -- the neighbour keeps the slot -- and the cursor -- where they were, the way closing one tab
      -- of several does.
      --
      -- shutdown() deletes the buffer of the terminal that exited. By then the window holds the
      -- neighbour's buffer, so shutdown() sees itself as closed and leaves the window alone. With
      -- no neighbour to show, it is still holding its own buffer, and the same call closes the
      -- window -- which is what should happen once the last terminal is gone.
      on_exit = function(term)
        vim.schedule(function()
          local neighbour = neighbour_terminal(term.id)
          if neighbour ~= nil then
            show_terminal(neighbour.id)
          end
          term:shutdown()

          -- Called again despite show_terminal() having queued its own restore: that one runs on
          -- the next tick and is undone here, since Neovim leaves Terminal mode itself once this
          -- callback returns. Only the delayed one below lands. The wasted call is harmless --
          -- both do nothing outside a terminal buffer -- and dropping it from show_terminal()
          -- would break the <M-n> path, which has no such delay to wait for.
          enter_terminal_mode(EXIT_MODE_RESTORE_DELAY_MS)
        end)
      end,
      on_create = function(term)
        -- Buffer-local on purpose: lua/plugins/claudecode.lua binds <C-q> globally for the
        -- Claude Code terminal, and a second global binding would let require() order decide
        -- which one survives. A buffer-local mapping outranks the global one inside toggleterm's
        -- terminals and leaves Claude Code's terminal untouched.
        --
        -- The cost is that <C-q> and <C-\> no longer reach the shell here (push-line and
        -- quoted-insert under zsh's emacs bindings); matching how the Claude Code terminal closes
        -- was worth more.
        for _, lhs in ipairs({ "<C-q>", [[<C-\>]] }) do
          vim.keymap.set("t", lhs, hide_terminals, {
            buffer = term.bufnr,
            silent = true,
            desc = "Hide the terminal",
          })
        end

        -- Terminal mode hands every unmapped key to the shell, so there is otherwise no way out of
        -- one terminal and into another: even <C-w>k reaches zsh rather than moving a window.
        -- These address terminals by number, matching the winbar above; a number nothing
        -- answers to yet starts that terminal. The cost is zsh's digit-argument.
        for id = 1, LAST_REACHABLE_TERMINAL do
          vim.keymap.set("t", ("<M-%d>"):format(id), function()
            show_terminal(id)
          end, {
            buffer = term.bufnr,
            silent = true,
            desc = ("Go to terminal %d"):format(id),
          })
        end
      end,
    })
  end,
}
