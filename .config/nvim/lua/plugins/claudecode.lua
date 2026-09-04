-- claudecode.nvim is loaded on first use, not at startup. <leader>ac is the sole entry
-- point that can be pressed before the plugin is on disk.
local function load_and_setup()
  -- setup() re-registers commands and, since auto_start defaults to true, restarts the
  -- server on every call, so guard against re-running it once claudecode is loaded.
  if package.loaded["claudecode"] then
    return
  end

  vim.cmd.packadd("claudecode.nvim")
  require("claudecode").setup({
    -- The default "auto" provider silently falls back to native when snacks.nvim isn't
    -- installed; naming it here makes the choice deterministic instead of environment-dependent.
    terminal = { provider = "native" },
  })

  -- These commands only exist once setup() has registered them, so the mappings are
  -- defined here rather than at module load time.
  vim.keymap.set(
    "n",
    "<leader>af",
    "<cmd>ClaudeCodeFocus<CR>",
    { noremap = true, silent = true, desc = "Focus Claude Code terminal" }
  )
  vim.keymap.set(
    "n",
    "<leader>am",
    "<cmd>ClaudeCodeSelectModel<CR>",
    { noremap = true, silent = true, desc = "Select Claude Code model" }
  )
  vim.keymap.set(
    "n",
    "<leader>aa",
    "<cmd>ClaudeCodeDiffAccept<CR>",
    { noremap = true, silent = true, desc = "Accept Claude Code diff" }
  )
  vim.keymap.set(
    "n",
    "<leader>ad",
    "<cmd>ClaudeCodeDiffDeny<CR>",
    { noremap = true, silent = true, desc = "Deny Claude Code diff" }
  )
end

vim.keymap.set("n", "<leader>ac", function()
  load_and_setup()
  vim.cmd("ClaudeCode")
end, { noremap = true, silent = true, desc = "Toggle Claude Code terminal" })
