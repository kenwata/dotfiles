local lazy = require("util.lazy")

-- mini.pick is loaded on first use, not at startup. The three mappings and vim.ui.select below
-- are the entry points that can trigger it before the plugin is on disk.
--
-- setup() re-creates highlight groups and user commands and reassigns vim.ui.select on every
-- call; util.lazy guards against re-running it once mini.pick is loaded.
local function load_minipick()
  return lazy.require("mini.pick", "mini.pick", function(minipick)
    minipick.setup()
  end)
end

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

vim.keymap.set("n", "<leader>ff", function()
  with_ripgreprc(function()
    load_minipick().builtin.files()
  end)
end, { noremap = true, silent = true, desc = "Find files by name" })

vim.keymap.set("n", "<leader>fg", function()
  with_ripgreprc(function()
    load_minipick().builtin.grep_live()
  end)
end, { noremap = true, silent = true, desc = "Search file contents (live grep)" })

-- Not wrapped in with_ripgreprc: this picker lists buffers from :buffers and never spawns rg.
vim.keymap.set("n", "<leader>fb", function()
  load_minipick().builtin.buffers()
end, { noremap = true, silent = true, desc = "Switch to an open file (buffers)" })

-- Forwards to the real MiniPick.ui_select explicitly (not by re-reading vim.ui.select): once
-- load_minipick() runs setup(), it reassigns vim.ui.select to MiniPick.ui_select itself, so
-- this wrapper is only ever invoked once, before mini.pick is on disk.
vim.ui.select = function(...)
  return load_minipick().ui_select(...)
end
