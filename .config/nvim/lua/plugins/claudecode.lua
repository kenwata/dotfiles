local lazy = require("common.lazy")

-- claudecode.nvim is loaded on first use, not at startup. Every <leader>a* key below is an
-- entry point that can be pressed before the plugin is on disk: each one loads the plugin
-- first, then runs its command. ClaudeCodeSend / ClaudeCodeAdd queue the mention and open
-- the terminal themselves when Claude is not running yet, and --resume / --continue can be
-- the first action of a session, so no single key can be assumed to come first.
--
-- setup() re-registers commands, terminal, diff, and autocmds on every call, but M.start()
-- (lua/claudecode/init.lua) early-returns once M.state.server exists, so it never restarts
-- the server. common.lazy still guards against re-running setup() once claudecode is loaded,
-- to avoid the redundant re-registration.
local function setup(claudecode)
  -- Every option the plugin reads is written out, including the ones kept at their default,
  -- so that each value is a deliberate choice rather than an inherited one. Options whose
  -- default is nil (terminal_cmd, terminal.cwd, terminal.cwd_provider) are omitted because a
  -- nil entry in a Lua table literal is indistinguishable from no entry.
  claudecode.setup({
    -- Server: the WebSocket server Claude Code connects to. The wide port range and
    -- auto-start are the plugin's defaults and nothing here needs to pin them.
    port_range = { min = 10000, max = 65535 },
    auto_start = true,
    env = {},
    log_level = "info",
    -- Selection: <leader>as sends the visual range as an at-mention, which needs tracking on.
    track_selection = true,
    -- Jump to the terminal right after a send so the instruction can be typed at once;
    -- jj brings the cursor back to the editing window.
    focus_after_send = true,
    visual_demotion_delay_ms = 50,
    -- Queued at-mentions (sent before Claude connected) wait this long after connect,
    -- give up connecting after 10 s, and are dropped after 5 s in the queue.
    connection_wait_delay = 600,
    connection_timeout = 10000,
    queue_timeout = 5000,
    -- Aliases resolve to the latest model of each tier (see `claude --help`, --model).
    -- This list replaces the plugin's default one rather than merging into it.
    models = {
      { name = "Claude Fable 5.1", value = "fable" },
      { name = "Claude Opus 5", value = "opus" },
      { name = "Claude Sonnet 5", value = "sonnet" },
    },
    terminal = {
      split_side = "right",
      split_width_percentage = 0.45,
      -- The default "auto" provider silently falls back to native when snacks.nvim isn't
      -- installed; naming it here makes the choice deterministic instead of environment-dependent.
      provider = "native",
      -- The tip is not visible in practice (checked in plan #7), and jj / <C-q> cover the exit.
      show_native_term_exit_tip = false,
      -- provider_opts and snacks_win_opts are only read by the external / snacks providers.
      provider_opts = {},
      auto_close = true,
      snacks_win_opts = {},
      -- Claude runs in Neovim's cwd, not the git root, so the two stay in step.
      git_repo_cwd = false,
    },
    diff_opts = {
      layout = "vertical",
      open_in_new_tab = false,
      keep_terminal_focus = false,
      -- Only meaningful with open_in_new_tab = true; kept at the default for that reason.
      hide_terminal_in_new_tab = false,
      on_new_file_reject = "keep_empty",
    },
  })
end

-- Builds the right-hand side of an entry key: load the plugin, then run `command`.
-- The command must be run through vim.cmd here rather than as a `<cmd>` mapping string
-- because it does not exist until setup() has registered it.
local function load_then_run(command)
  return function()
    lazy.require("claudecode.nvim", "claudecode", setup)
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
