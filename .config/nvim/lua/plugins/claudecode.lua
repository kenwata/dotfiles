-- claudecode.nvim is loaded on first use, not at startup. Every <leader>a* key below is an
-- entry point that can be pressed before the plugin is on disk: each one loads the plugin
-- first, then runs its command. ClaudeCodeSend / ClaudeCodeAdd queue the mention and open
-- the terminal themselves when Claude is not running yet, and --resume / --continue can be
-- the first action of a session, so no single key can be assumed to come first.
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
end

-- Builds the right-hand side of an entry key: load the plugin, then run `command`.
-- The command must be run through vim.cmd here rather than as a `<cmd>` mapping string
-- because it does not exist until setup() has registered it.
local function load_then_run(command)
  return function()
    load_and_setup()
    vim.cmd(command)
  end
end

-- One record per entry key: { mode, lhs, command, desc }. The set and the key choices
-- follow the default keymap example in claudecode.nvim's README.
local entry_keys = {
  { "n", "<leader>ac", "ClaudeCode", "Toggle Claude Code terminal" },
  { "n", "<leader>af", "ClaudeCodeFocus", "Focus Claude Code terminal" },
  { "n", "<leader>ar", "ClaudeCode --resume", "Resume a Claude Code session" },
  { "n", "<leader>aC", "ClaudeCode --continue", "Continue the last Claude Code session" },
  { "n", "<leader>am", "ClaudeCodeSelectModel", "Select Claude Code model" },
  -- ClaudeCodeAdd expands its path argument itself, so `%` is resolved to the current buffer.
  { "n", "<leader>ab", "ClaudeCodeAdd %", "Add current buffer to Claude Code" },
  { "v", "<leader>as", "ClaudeCodeSend", "Send selection to Claude Code" },
  { "n", "<leader>aa", "ClaudeCodeDiffAccept", "Accept Claude Code diff" },
  { "n", "<leader>ad", "ClaudeCodeDiffDeny", "Deny Claude Code diff" },
}

for _, key in ipairs(entry_keys) do
  local mode, lhs, command, desc = key[1], key[2], key[3], key[4]
  vim.keymap.set(mode, lhs, load_then_run(command), { noremap = true, silent = true, desc = desc })
end

-- Close the terminal from terminal mode. Space is sent straight to Claude Code in terminal
-- mode, so this cannot start with <leader>; Ctrl-Q is a plain Ctrl key that is not bound in
-- Claude Code's defaults and that the terminal does not treat specially. Terminal-mode mappings
-- only fire inside a terminal buffer, so the mapping is global rather than buffer-local.
-- This key is not an entry point: with nothing loaded there is nothing to close.
vim.keymap.set("t", "<C-q>", function()
  if package.loaded["claudecode"] then
    vim.cmd("ClaudeCodeClose")
  end
end, { noremap = true, silent = true, desc = "Close Claude Code terminal" })
