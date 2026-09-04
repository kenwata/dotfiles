-- Declare every plugin exactly once, here. Per-plugin configuration lives in its own
-- lua/plugins/<name>.lua.
vim.pack.add({
  { src = "https://github.com/coder/claudecode.nvim", version = vim.version.range("0.3") },
}, {
  -- Without this, vim.pack loads plugin/ files during this same startup sequence even
  -- though `load` defaults to false here (see :packadd! in :help repeat.txt). Loading is
  -- deferred entirely to the stub mappings defined in each plugin's own file.
  load = function() end,
})

require("plugins.claudecode")
