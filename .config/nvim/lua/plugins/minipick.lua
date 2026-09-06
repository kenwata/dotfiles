-- mini.pick is loaded on first use, not at startup. The two mappings below are the entry
-- points that can be pressed before the plugin is on disk.
--
-- setup() re-creates highlight groups and user commands and reassigns vim.ui.select on every
-- call, so package.loaded marks that it has already run.
local function load_minipick()
  if not package.loaded["mini.pick"] then
    vim.cmd.packadd("mini.pick")
    require("mini.pick").setup()
  end

  return require("mini.pick")
end

vim.keymap.set("n", "<leader>ff", function()
  load_minipick().builtin.files()
end, { noremap = true, silent = true, desc = "Find files by name" })

vim.keymap.set("n", "<leader>fg", function()
  load_minipick().builtin.grep_live()
end, { noremap = true, silent = true, desc = "Search file contents (live grep)" })
