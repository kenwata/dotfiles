local lazy = require("util.lazy")

-- Highest terminal number reachable with <M-n> from inside a terminal. Nine is simply how many
-- digits there are; nothing in toggleterm caps the count.
local LAST_REACHABLE_TERMINAL = 9

--- Returns every terminal that currently occupies a window.
---@return table[]
local function open_terminals()
  return vim.tbl_filter(function(term)
    return term:is_open()
  end, require("toggleterm.terminal").get_all(true))
end

--- Brings terminal `id` up on its own, starting it when that number is unused.
---
--- toggleterm opens each terminal in its own split, so opening a second one leaves both visible
--- side by side. Closing the others first turns the terminal area into a single slot whose
--- occupant this swaps -- the winbar above it then reads as the tab bar for that slot.
---@param id integer
local function show_terminal(id)
  for _, other in ipairs(open_terminals()) do
    if other.id ~= id then
      other:close()
    end
  end

  local term = require("toggleterm.terminal").get_or_create_term(id)

  -- Closed and reopened even when it is already up, because open() is the only path that lands
  -- in Terminal mode (it honours start_in_insert). focus() merely re-points the cursor, leaving
  -- Normal mode in place -- and there the Terminal-mode <M-n> mappings no longer fire, so one
  -- hop in, the next is impossible. startinsert does not survive either, whether called outright
  -- or through vim.schedule: the mapping's callback undoes it as it returns. Only the window
  -- closes here; the shell keeps running.
  if term:is_open() then
    term:close()
  end
  term:open()

  -- open() reaches its own startinsert only when it reuses an existing buffer; on the path that
  -- spawns a new shell the window is not current yet at that point, and the terminal is left in
  -- Normal mode. Scheduling it here covers both paths -- and by the time it runs the mapping's
  -- callback has returned, which is what undoes a startinsert called any earlier.
  vim.schedule(function()
    if vim.bo.buftype == "terminal" then
      vim.cmd.startinsert()
    end
  end)
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

-- toggleterm is loaded on first use, not at startup: a terminal has no bearing on the first
-- frame drawn. The repository ships no plugin/ directory, and setup() is what creates both the
-- commands (:ToggleTerm and seven others) and the mappings, so packadd alone does nothing --
-- which is exactly what makes the stubs below sufficient as the only entry points.
local function setup(toggleterm)
  -- Only the options this config actually decides are written out. The rest keep their
  -- defaults: start_in_insert, persist_size, shade_terminals, close_on_exit, auto_scroll,
  -- hide_numbers, autochdir, clear_env, shell, float_opts and responsiveness.
  toggleterm.setup({
    -- open_mapping is deliberately left unset. It would bind <Cmd>ToggleTerm<CR>, which opens a
    -- terminal alongside any already on screen; the mappings at the bottom of this file route
    -- every entry point through show_terminal() so that exactly one terminal is ever visible.
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
end

-- v:count is read before loading because it does not survive the require: `2<C-\>` has to reach
-- the second terminal on the very first press too.
vim.keymap.set("n", [[<c-\>]], function()
  local count = vim.v.count
  lazy.require("toggleterm.nvim", "toggleterm", setup)

  if count > 0 then
    show_terminal(count)
  elseif #open_terminals() > 0 then
    hide_terminals()
  else
    -- No count and nothing on screen: reopen whichever terminal was used last, or start the
    -- first one. get_last_focused() returns nil until a terminal has been focused at least once.
    local last = require("toggleterm.terminal").get_last_focused()
    show_terminal(last and last.id or 1)
  end
end, { noremap = true, silent = true, desc = "Toggle the terminal" })
