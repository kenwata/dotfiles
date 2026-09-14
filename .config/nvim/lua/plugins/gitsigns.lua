-- gitsigns.nvim is loaded the first time a buffer is read: sign-column changes have no bearing
-- on the first frame drawn (signcolumn = "yes" already reserves the column, lua/config/general.lua),
-- and BufNewFile covers files created inside the session that BufReadPost would miss.

-- signs / signs_staged / numhl were picked on the real terminal (Ghostty) with the sign-pattern
-- harness the design doc lays out, comparing "既定" (v2.1.0 defaults, chosen below) against
-- "細線" and "記号" alternatives; numhl was compared against a numhl = true variant. v2.1.0's
-- defaults are spelled out explicitly rather than left unset, so this is a recorded decision
-- rather than an inherited one (same reasoning as claudecode.lua's fully-spelled-out setup()).

-- One record per buffer-local mapping created in on_attach below: { mode, lhs, rhs, desc }.
local function build_keymaps(gitsigns)
  return {
    {
      mode = "n",
      lhs = "]c",
      rhs = function()
        if vim.wo.diff then
          vim.cmd.normal({ "]c", bang = true })
        else
          gitsigns.nav_hunk("next")
        end
      end,
      desc = "Go to next hunk (or next diff change in diff mode)",
    },
    {
      mode = "n",
      lhs = "[c",
      rhs = function()
        if vim.wo.diff then
          vim.cmd.normal({ "[c", bang = true })
        else
          gitsigns.nav_hunk("prev")
        end
      end,
      desc = "Go to previous hunk (or previous diff change in diff mode)",
    },
    {
      mode = "n",
      lhs = "<Leader>gs",
      rhs = gitsigns.stage_hunk,
      desc = "Stage hunk under cursor (unstages if already staged)",
    },
    {
      mode = "x",
      lhs = "<Leader>gs",
      rhs = function()
        gitsigns.stage_hunk({ vim.fn.line("."), vim.fn.line("v") })
      end,
      desc = "Stage selected lines",
    },
    {
      mode = "n",
      lhs = "<Leader>gr",
      rhs = gitsigns.reset_hunk,
      desc = "Reset hunk under cursor to last commit",
    },
    {
      mode = "x",
      lhs = "<Leader>gr",
      rhs = function()
        gitsigns.reset_hunk({ vim.fn.line("."), vim.fn.line("v") })
      end,
      desc = "Reset selected lines to last commit",
    },
    {
      mode = "n",
      lhs = "<Leader>gp",
      rhs = gitsigns.preview_hunk,
      desc = "Preview hunk under cursor",
    },
    {
      mode = "n",
      lhs = "<Leader>gb",
      rhs = gitsigns.blame,
      desc = "Show file blame in a vertical split",
    },
    {
      mode = { "o", "x" },
      lhs = "ih",
      rhs = gitsigns.select_hunk,
      desc = "Select hunk under cursor",
    },
  }
end

return {
  "lewis6991/gitsigns.nvim",
  version = "2",
  event = { "BufReadPost", "BufNewFile" },
  opts = {
    signs = {
      add = { text = "┃" },
      change = { text = "┃" },
      delete = { text = "▁" },
      topdelete = { text = "▔" },
      changedelete = { text = "~" },
      untracked = { text = "┆" },
    },
    signs_staged = {
      add = { text = "┃" },
      change = { text = "┃" },
      delete = { text = "▁" },
      topdelete = { text = "▔" },
      changedelete = { text = "~" },
    },
    numhl = false,
    on_attach = function(bufnr)
      local gitsigns = require("gitsigns")

      for _, map in ipairs(build_keymaps(gitsigns)) do
        vim.keymap.set(map.mode, map.lhs, map.rhs, { buffer = bufnr, desc = map.desc })
      end

      -- mini.clue only re-derives its buffer-local triggers on BufWinEnter / LspAttach
      -- (lua/mini/clue.lua), neither of which fires after this async on_attach. Without this,
      -- the ]/<Leader> triggers created above by mini.clue's own setup() would predate these
      -- buffer-local mappings and stop working, per mini.clue's caveats in doc/mini-clue.txt.
      if package.loaded["mini.clue"] then
        require("mini.clue").ensure_buf_triggers(bufnr)
      end
    end,
  },
  -- config takes opts as its second argument rather than closing over the table above, so that
  -- a script can swap plugin.opts before gitsigns loads (used by the sign-pattern harness the
  -- design doc lays out for picking signs / signs_staged / numhl on the real terminal).
  config = function(_, opts)
    require("gitsigns").setup(opts)
  end,
}
