-- init.lua sets this before any module that defines a <leader> mapping is required.
---@type string
local mapleader = vim.g.mapleader

---@class miniclue.Trigger
---@field lhs string Key passed to vim.keymap.set; may use <Leader>.
---@field replay string Actual key sequence fed back via nvim_feedkeys after loading.
---@field modes string[] Modes to stub this key in.

---@type miniclue.Trigger[]
local TRIGGERS = {
  { lhs = "<Leader>", replay = mapleader, modes = { "n", "x" } },
  { lhs = "g", replay = "g", modes = { "n", "x" } },
  { lhs = "s", replay = "s", modes = { "n" } },
  { lhs = "z", replay = "z", modes = { "n", "x" } },
  { lhs = "[", replay = "[", modes = { "n", "x" } },
  { lhs = "]", replay = "]", modes = { "n", "x" } },
  { lhs = "<C-w>", replay = vim.api.nvim_replace_termcodes("<C-w>", true, false, true), modes = { "n" } },
  { lhs = '"', replay = '"', modes = { "n", "x" } },
  { lhs = "'", replay = "'", modes = { "n", "x" } },
  { lhs = "`", replay = "`", modes = { "n", "x" } },
  { lhs = "<C-x>", replay = vim.api.nvim_replace_termcodes("<C-x>", true, false, true), modes = { "i" } },
}

local function delete_stubs()
  for _, trigger in ipairs(TRIGGERS) do
    for _, mode in ipairs(trigger.modes) do
      vim.keymap.del(mode, trigger.lhs)
    end
  end
end

local function on_trigger(trigger)
  return function()
    delete_stubs()
    require("lazy").load({ plugins = { "mini.clue" } })
    vim.api.nvim_feedkeys(trigger.replay, "mi", false)
  end
end

return {
  "echasnovski/mini.clue",
  version = "0.18",
  -- mini.clue is loaded on first use, not at startup: it has no bearing on the first frame
  -- drawn and its config() creates keymaps and autocommands (a runtime effect, not just
  -- configuration data), so plan.md's startup-load exception does not apply. lazy = true with
  -- no trigger declared: unlike claudecode.nvim and mini.pick, the entry points here are not
  -- real commands but the 19 stubs below, which exist only to load mini.clue and then replay
  -- the key that triggered them, so mini.clue's own (buffer-local) triggers can take over from
  -- the second press onward.
  lazy = true,
  init = function()
    for _, trigger in ipairs(TRIGGERS) do
      for _, mode in ipairs(trigger.modes) do
        vim.keymap.set(mode, trigger.lhs, on_trigger(trigger), {
          nowait = true,
          desc = "Load mini.clue, then replay " .. trigger.lhs,
        })
      end
    end
  end,
  config = function()
    -- Named groups for prefixes whose own desc does not say what the group is (mini.clue's
    -- gen_clues cover the builtin groups: g, square_brackets, marks, registers, windows, z,
    -- builtin_completion). s is not listed here: keybind.lua's desc on each ssvhjk mapping
    -- already says what it does.
    local miniclue = require("mini.clue")

    miniclue.setup({
      triggers = {
        { mode = "n", keys = "<Leader>" },
        { mode = "x", keys = "<Leader>" },
        { mode = "n", keys = "g" },
        { mode = "x", keys = "g" },
        { mode = "n", keys = "s" },
        { mode = "n", keys = "z" },
        { mode = "x", keys = "z" },
        { mode = "n", keys = "[" },
        { mode = "x", keys = "[" },
        { mode = "n", keys = "]" },
        { mode = "x", keys = "]" },
        { mode = "n", keys = "<C-w>" },
        { mode = "n", keys = '"' },
        { mode = "x", keys = '"' },
        { mode = "n", keys = "'" },
        { mode = "x", keys = "'" },
        { mode = "n", keys = "`" },
        { mode = "x", keys = "`" },
        { mode = "i", keys = "<C-x>" },
      },
      clues = {
        { mode = "n", keys = "<Leader>a", desc = "+Claude Code" },
        { mode = "x", keys = "<Leader>a", desc = "+Claude Code" },
        { mode = "n", keys = "<Leader>f", desc = "+Find" },
        { mode = "n", keys = "<Leader>i", desc = "+Toggle display" },
        miniclue.gen_clues.builtin_completion(),
        miniclue.gen_clues.g(),
        miniclue.gen_clues.marks(),
        miniclue.gen_clues.registers(),
        miniclue.gen_clues.windows(),
        miniclue.gen_clues.z(),
        miniclue.gen_clues.square_brackets(),
      },
      window = {
        delay = 300,
        -- Default width is a fixed 30 columns (mini-clue.txt:561-562), which truncates the
        -- longest square_brackets descriptions ([E/[F etc.) to the same prefix and makes them
        -- indistinguishable. "auto" sizes the window to the widest clue line instead.
        config = { width = "auto" },
      },
    })
  end,
}
