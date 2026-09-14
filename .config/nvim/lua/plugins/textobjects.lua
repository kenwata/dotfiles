---@class textobjects.SelectKey
---@field key string Key suffixed to `a`/`i`, e.g. "af" for the outer function object.
---@field query string Treesitter capture name passed to select_textobject.
---@field desc string

---@type textobjects.SelectKey[]
local SELECT_KEYS = {
  { key = "af", query = "@function.outer", desc = "Select a function (outer)" },
  { key = "if", query = "@function.inner", desc = "Select a function (inner)" },
  { key = "ac", query = "@class.outer", desc = "Select a class (outer)" },
  { key = "ic", query = "@class.inner", desc = "Select a class (inner)" },
  { key = "aa", query = "@parameter.outer", desc = "Select a parameter (outer)" },
  { key = "ia", query = "@parameter.inner", desc = "Select a parameter (inner)" },
  { key = "ai", query = "@conditional.outer", desc = "Select a conditional (outer)" },
  { key = "ii", query = "@conditional.inner", desc = "Select a conditional (inner)" },
  { key = "al", query = "@loop.outer", desc = "Select a loop (outer)" },
  { key = "il", query = "@loop.inner", desc = "Select a loop (inner)" },
  { key = "am", query = "@call.outer", desc = "Select a function call (outer)" },
  { key = "im", query = "@call.inner", desc = "Select a function call (inner)" },
  { key = "a=", query = "@assignment.outer", desc = "Select an assignment (outer)" },
  { key = "i=", query = "@assignment.inner", desc = "Select an assignment (inner)" },
  { key = "ar", query = "@return.outer", desc = "Select a return statement (outer)" },
  { key = "ir", query = "@return.inner", desc = "Select a return statement (inner)" },
  { key = "ak", query = "@comment.outer", desc = "Select a comment (outer)" },
  { key = "ik", query = "@comment.inner", desc = "Select a comment (inner)" },
  { key = "ao", query = "@block.outer", desc = "Select a block (outer)" },
  { key = "io", query = "@block.inner", desc = "Select a block (inner)" },
  { key = "in", query = "@number.inner", desc = "Select a number (inner)" },
  { key = "ag", query = "@statement.outer", desc = "Select a statement (outer)" },
}

---@class textobjects.MoveKey
---@field key string
---@field func "goto_next_start"|"goto_previous_start"|"goto_next_end"|"goto_previous_end"
---@field queries string[] Treesitter capture names, tried in order.
---@field desc string

---@type textobjects.MoveKey[]
local MOVE_KEYS = {
  { key = "]F", func = "goto_next_start", queries = { "@function.outer" }, desc = "Go to next function start" },
  { key = "[F", func = "goto_previous_start", queries = { "@function.outer" }, desc = "Go to previous function start" },
  { key = "]E", func = "goto_next_end", queries = { "@function.outer" }, desc = "Go to next function end" },
  { key = "[E", func = "goto_previous_end", queries = { "@function.outer" }, desc = "Go to previous function end" },
  { key = "]k", func = "goto_next_start", queries = { "@class.outer" }, desc = "Go to next class start" },
  { key = "[k", func = "goto_previous_start", queries = { "@class.outer" }, desc = "Go to previous class start" },
}

local keys = {}

for _, entry in ipairs(SELECT_KEYS) do
  table.insert(keys, {
    entry.key,
    function()
      require("nvim-treesitter-textobjects.select").select_textobject(entry.query, "textobjects")
    end,
    mode = { "x", "o" },
    desc = entry.desc,
  })
end

for _, entry in ipairs(MOVE_KEYS) do
  table.insert(keys, {
    entry.key,
    function()
      require("nvim-treesitter-textobjects.move")[entry.func](entry.queries, "textobjects")
    end,
    mode = { "n", "x", "o" },
    desc = entry.desc,
  })
end

table.insert(keys, {
  "<Leader>s",
  function()
    require("nvim-treesitter-textobjects.swap").swap_next({ "@parameter.inner" }, "textobjects")
  end,
  desc = "Swap parameter with next",
})

table.insert(keys, {
  "<Leader>S",
  function()
    require("nvim-treesitter-textobjects.swap").swap_previous({ "@parameter.inner" }, "textobjects")
  end,
  desc = "Swap parameter with previous",
})

return {
  "nvim-treesitter/nvim-treesitter-textobjects",
  commit = "5c7b0263797dfd1bd6202f2b219f3b53a80b2187",
  -- nvim-treesitter-textobjects has no plugin/ directory: it only exposes functions, so there
  -- is no startup-time work to defer around. Loading is deferred purely to keep the first
  -- require (and the parser/query lookups it triggers) off the startup path. surround.lua also
  -- loads this plugin, through lazy.nvim's own API rather than through a key here.
  keys = keys,
  config = function()
    require("nvim-treesitter-textobjects").setup({ select = { lookahead = true } })
  end,
}
