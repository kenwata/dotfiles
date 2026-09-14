-- claudecode.nvim is loaded on first use, not at startup. Every <leader>a* key below is an
-- entry point that can be pressed before the plugin is on disk: each one loads the plugin
-- first, then runs its command. ClaudeCodeSend / ClaudeCodeAdd queue the mention and open
-- the terminal themselves when Claude is not running yet, and --resume / --continue can be
-- the first action of a session, so no single key can be assumed to come first.

-- One record per entry key: { mode, lhs, command, desc }. The set and the key choices follow
-- the default keymap example in claudecode.nvim's README.
local ENTRY_KEYS = {
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

local keys = {}
for _, entry in ipairs(ENTRY_KEYS) do
  local mode, lhs, command, desc = entry[1], entry[2], entry[3], entry[4]
  table.insert(keys, {
    lhs,
    -- Run through vim.cmd rather than a `<cmd>` mapping string: the command does not exist
    -- until config() below has registered it, and lazy.nvim runs config() before calling this
    -- function on the key's first press.
    function()
      vim.cmd(command)
    end,
    mode = mode,
    desc = desc,
    silent = true,
  })
end

return {
  "coder/claudecode.nvim",
  version = "0.3",
  keys = keys,
  init = function()
    -- Close the terminal from terminal mode. Space is sent straight to Claude Code in terminal
    -- mode, so this cannot start with <leader>; Ctrl-Q is a plain Ctrl key that is not bound in
    -- Claude Code's defaults and that the terminal does not treat specially. Terminal-mode
    -- mappings only fire inside a terminal buffer, so the mapping is global rather than
    -- buffer-local. This key is not an entry point: with nothing loaded there is nothing to
    -- close, so it only checks package.loaded rather than triggering a load of its own.
    vim.keymap.set("t", "<C-q>", function()
      if package.loaded["claudecode"] then
        vim.cmd("ClaudeCodeClose")
      end
    end, { noremap = true, silent = true, desc = "Close Claude Code terminal" })
  end,
  config = function()
    -- Every option the plugin reads is written out, including the ones kept at their default,
    -- so that each value is a deliberate choice rather than an inherited one. Options whose
    -- default is nil (terminal_cmd, terminal.cwd, terminal.cwd_provider) are omitted because a
    -- nil entry in a Lua table literal is indistinguishable from no entry.
    require("claudecode").setup({
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
  end,
}
