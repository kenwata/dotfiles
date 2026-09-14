-- diffview-plus.nvim is loaded on first use, not at startup: the 11 commands plugin/diffview.lua
-- defines are the entry points, and <Leader>gd / <Leader>gh below drive two of them without
-- waiting for a command to be typed. Keys inside the diffview windows themselves stay at their
-- defaults (non-scope in the design doc).
return {
  "dlyongemallo/diffview-plus.nvim",
  version = "0.37",
  cmd = {
    "DiffviewOpen",
    "DiffviewToggle",
    "DiffviewDiffFiles",
    "DiffviewMergeFiles",
    "DiffviewDiffDirs",
    "DiffviewFileHistory",
    "DiffviewClose",
    "DiffviewFocusFiles",
    "DiffviewToggleFiles",
    "DiffviewRefresh",
    "DiffviewLog",
  },
  keys = {
    { "<Leader>gd", "<Cmd>DiffviewToggle<CR>", desc = "Toggle diff view of all changed files" },
    { "<Leader>gh", "<Cmd>DiffviewFileHistory %<CR>", desc = "Show file history of current file" },
  },
}
