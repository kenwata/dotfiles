local lazy = require("util.lazy")

-- mini.files is loaded on first use, not at startup: opening the explorer has no bearing on
-- the first frame drawn.
--
-- options.use_as_default_explorer replaces netrw for directories opened via `nvim <dir>` or
-- `:e <dir>`, but only once setup() has run. While mini.files stays lazy, setup() does not
-- run until first use, so the BufEnter stub below covers every directory buffer opened
-- before that point.
local function setup(minifiles)
  minifiles.setup({
    options = {
      permanent_delete = true,
      use_as_default_explorer = true,
    },
  })
end

local function load_minifiles()
  return lazy.require("mini.files", "mini.files", setup)
end

-- vim.g.loaded_netrw alone is not enough: plugin/netrwPlugin.vim still re-registers the
-- FileExplorer autocmd after init.lua runs (Neovim's startup order is init.lua, then
-- plugin/, then the buffer for the command-line argument), in time for `nvim <dir>`.
-- Disabling netrw's plugin/ file via loaded_netrwPlugin is what actually stops it.
vim.g.loaded_netrw = 1
vim.g.loaded_netrwPlugin = 1

local netrw_replacement_group = vim.api.nvim_create_augroup("minifiles_netrw_replacement", { clear = true })

vim.api.nvim_create_autocmd("BufEnter", {
  group = netrw_replacement_group,
  desc = "Open mini.files in place of netrw for the first directory buffer",
  callback = function()
    local bufname = vim.api.nvim_buf_get_name(0)
    if vim.fn.isdirectory(bufname) == 0 then
      return
    end

    -- Only the first directory buffer needs this stub; mini.files' own BufEnter (registered
    -- by setup()) takes over from the second one onward. bufhidden and
    -- minifiles_processed_dir mirror what mini.files' own handler sets, so the outcome
    -- matches whichever handler ends up processing the buffer.
    vim.api.nvim_del_augroup_by_id(netrw_replacement_group)
    vim.bo.bufhidden = "wipe"
    vim.b.minifiles_processed_dir = true
    vim.schedule(function()
      load_minifiles().open(bufname, false)
    end)
  end,
})

vim.keymap.set("n", "<Leader>e", function()
  local minifiles = load_minifiles()
  if not minifiles.close() then
    minifiles.open()
  end
end, { silent = true, desc = "Toggle the file explorer" })
