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
          require("mini.pick").builtin.files()
        end)
      end,
      desc = "Find files by name",
      silent = true,
    },
    {
      "<leader>fg",
      function()
        with_ripgreprc(function()
          require("mini.pick").builtin.grep_live()
        end)
      end,
      desc = "Search file contents (live grep)",
      silent = true,
    },
    -- Not wrapped in with_ripgreprc: this picker lists buffers from :buffers and never spawns rg.
    {
      "<leader>fb",
      function()
        require("mini.pick").builtin.buffers()
      end,
      desc = "Switch to an open file (buffers)",
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
        -- is read, and long paths in the candidate list need the horizontal pair.
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
