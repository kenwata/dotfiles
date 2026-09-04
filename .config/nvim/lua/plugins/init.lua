-- Declare every plugin exactly once, here. Per-plugin configuration lives in its own
-- lua/plugins/<name>.lua.
vim.pack.add({
  { src = "https://github.com/coder/claudecode.nvim", version = vim.version.range("0.3") },
  { src = "https://github.com/neovim/nvim-lspconfig", version = vim.version.range("2") },
}, {
  -- Without this, vim.pack loads plugin/ files during this same startup sequence even
  -- though `load` defaults to false here (see :packadd! in :help repeat.txt). Loading is
  -- deferred entirely to each plugin's own file, which decides when to call
  -- vim.cmd.packadd(): on first use for a lazy-loaded plugin, or immediately at require()
  -- time for a plugin that is merely a repository of configuration data.
  load = function() end,
})

require("plugins.claudecode")
require("plugins.lspconfig")
