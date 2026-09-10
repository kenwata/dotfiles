-- Declare every plugin exactly once, here. Per-plugin configuration lives in its own
-- lua/plugins/<name>.lua.
vim.pack.add({
  { src = "https://github.com/coder/claudecode.nvim", version = vim.version.range("0.3") },
  { src = "https://github.com/neovim/nvim-lspconfig", version = vim.version.range("2") },
  { src = "https://github.com/echasnovski/mini.icons", version = vim.version.range("0.18") },
  { src = "https://github.com/echasnovski/mini.pick", version = vim.version.range("0.18") },
  { src = "https://github.com/echasnovski/mini.clue", version = vim.version.range("0.18") },
  { src = "https://github.com/echasnovski/mini.files", version = vim.version.range("0.18") },
  { src = "https://github.com/echasnovski/mini.tabline", version = vim.version.range("0.18") },
  { src = "https://github.com/akinsho/toggleterm.nvim", version = vim.version.range("2") },
  { src = "https://github.com/OXY2DEV/markview.nvim", version = vim.version.range("28") },
  { src = "https://github.com/ellisonleao/gruvbox.nvim", version = vim.version.range("2") },
  { src = "https://github.com/nvim-lualine/lualine.nvim", version = "221ce6b2d999187044529f49da6554a92f740a96" },
  { src = "https://github.com/nvim-treesitter/nvim-treesitter", version = "5cb0114e6242625db56dd6440e945ed1ece10bc7" },
  { src = "https://github.com/kylechui/nvim-surround", version = vim.version.range("4") },
  { src = "https://github.com/nvim-treesitter/nvim-treesitter-textobjects", version = "5c7b0263797dfd1bd6202f2b219f3b53a80b2187" },
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
require("plugins.miniicons")
require("plugins.minipick")
require("plugins.miniclue")
require("plugins.minifiles")
require("plugins.minitabline")
require("plugins.toggleterm")
require("plugins.markview")
require("plugins.gruvbox")
require("plugins.lualine")
require("plugins.treesitter")
require("plugins.textobjects")
