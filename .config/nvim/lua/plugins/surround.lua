local lazy = require("common.lazy")

-- plugin/nvim-surround.lua reads this global when packadd runs, so it must be set before
-- that point (module load time). Setting it later, e.g. inside load_surround(), would not
-- stop the plugin's default keymaps from being registered.
vim.g.nvim_surround_no_mappings = true

local function load_surround()
  -- Load textobjects first so nvim-surround's `f` (call surround) can resolve @call.outer;
  -- without it, `f` silently falls back to a regex match instead of erroring (design doc,
  -- "依存関係と落とし穴" #1).
  require("plugins.textobjects").load()

  return lazy.require("nvim-surround", "nvim-surround", function(surround)
    surround.setup()
  end)
end

---@class surround.Stub
---@field mode string
---@field lhs string
---@field plug string `<Plug>` mapping name nvim-surround exposes for this action.
---@field desc string

---@type surround.Stub[]
local SURROUND_KEYS = {
  { mode = "n", lhs = "ys", plug = "<Plug>(nvim-surround-normal)", desc = "Add a surround around a motion" },
  { mode = "n", lhs = "yss", plug = "<Plug>(nvim-surround-normal-cur)", desc = "Add a surround around the current line" },
  {
    mode = "n",
    lhs = "yS",
    plug = "<Plug>(nvim-surround-normal-line)",
    desc = "Add a surround around a motion, placed on its own line",
  },
  {
    mode = "n",
    lhs = "ySS",
    plug = "<Plug>(nvim-surround-normal-cur-line)",
    desc = "Add a surround around the current line, placed on its own line",
  },
  { mode = "n", lhs = "ds", plug = "<Plug>(nvim-surround-delete)", desc = "Delete a surround" },
  { mode = "n", lhs = "cs", plug = "<Plug>(nvim-surround-change)", desc = "Change a surround" },
  {
    mode = "n",
    lhs = "cS",
    plug = "<Plug>(nvim-surround-change-line)",
    desc = "Change a surround, placed on its own line",
  },
  { mode = "x", lhs = "S", plug = "<Plug>(nvim-surround-visual)", desc = "Add a surround around the selection" },
  {
    mode = "x",
    lhs = "gS",
    plug = "<Plug>(nvim-surround-visual-line)",
    desc = "Add a surround around the selection, placed on its own line",
  },
  { mode = "i", lhs = "<C-g>s", plug = "<Plug>(nvim-surround-insert)", desc = "Insert a surround at the cursor" },
  {
    mode = "i",
    lhs = "<C-g>S",
    plug = "<Plug>(nvim-surround-insert-line)",
    desc = "Insert a surround at the cursor, placed on its own line",
  },
}

for _, entry in ipairs(SURROUND_KEYS) do
  vim.keymap.set(entry.mode, entry.lhs, function()
    load_surround()

    return entry.plug
  end, { expr = true, silent = true, desc = entry.desc })
end
