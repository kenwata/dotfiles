local lazy = require("util.lazy")

-- toggleterm is loaded on first use, not at startup: a terminal has no bearing on the first
-- frame drawn. The repository ships no plugin/ directory, and setup() is what creates both the
-- commands (:ToggleTerm and seven others) and the mappings, so packadd alone does nothing --
-- which is exactly what makes the stub below sufficient as the single entry point.
local function setup(toggleterm)
  -- Only the options this config actually decides are written out. The rest keep their
  -- defaults: start_in_insert, persist_mode, persist_size, shade_terminals, close_on_exit,
  -- auto_scroll, hide_numbers, autochdir, clear_env, shell, winbar, float_opts and
  -- responsiveness.
  toggleterm.setup({
    -- Ctrl-\ over <Leader>tt: <Leader> is Space, which a terminal sends straight to the shell,
    -- so a <Leader> mapping could not close the terminal from inside it. In Normal mode the
    -- key costs nothing -- the built-in CTRL-\ CTRL-N is a no-op there (:help index.txt).
    open_mapping = [[<c-\>]],
    -- Horizontal keeps the terminal clear of claudecode.nvim, which puts its own terminal in a
    -- vertical split on the right (lua/plugins/claudecode.lua).
    direction = "horizontal",
    size = 12,
    -- Insert mode keeps its own CTRL-\: i_CTRL-\_CTRL-N and i_CTRL-\_CTRL-G both return to
    -- Normal mode, and taking the prefix would retire them. jj already leaves insert mode
    -- (lua/config/keybind.lua), so opening a terminal from Normal mode costs one keystroke.
    insert_mappings = false,
    -- Puts open_mapping inside toggleterm's own terminal buffers, buffer-locally, so the same
    -- key that opened the terminal also closes it from within.
    terminal_mappings = true,
    on_create = function(term)
      -- Buffer-local on purpose: lua/plugins/claudecode.lua binds <C-q> globally for the
      -- Claude Code terminal, and a second global binding would let require() order decide
      -- which one survives. A buffer-local mapping outranks the global one inside
      -- toggleterm's terminals and leaves Claude Code's terminal untouched.
      --
      -- The cost is that <C-q> no longer reaches the shell here (push-line under zsh's emacs
      -- bindings); matching how the Claude Code terminal closes was worth more.
      vim.keymap.set("t", "<C-q>", "<Cmd>ToggleTerm<CR>", {
        buffer = term.bufnr,
        silent = true,
        desc = "Close the toggleterm terminal",
      })
    end,
  })
end

-- v:count is read here rather than left to toggleterm because this stub answers the very first
-- press: `2<C-\>` has to reach the second terminal on that press too, not only once toggleterm
-- has replaced this mapping with its own (which spells the same thing as
-- <Cmd>execute v:count . "ToggleTerm"<CR>).
vim.keymap.set("n", [[<c-\>]], function()
  local count = vim.v.count
  lazy.require("toggleterm.nvim", "toggleterm", setup)
  vim.cmd(count .. "ToggleTerm")
end, { noremap = true, silent = true, desc = "Toggle a terminal" })
