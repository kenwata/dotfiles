local lazy = require("util.lazy")

-- markview.nvim is loaded on first use, not at startup: decorating markdown has no bearing
-- on the first frame drawn (plan.md §6). Unlike every other lazy-loaded plugin here, it has
-- no key that means "start using this now" -- opening a markdown buffer is itself the moment
-- decoration becomes relevant, so the entry point is a FileType autocmd rather than a key.
--
-- Only preview.icon_provider and preview.filetypes are set below; every other preview.*
-- option (20+) and every filetype-specific config (markdown, markdown_inline, html, yaml,
-- latex, typst, asciidoc, comment) is left at its default.
local function setup(markview)
  markview.setup({
    preview = {
      -- mini.icons was already loaded at startup by plugins/miniicons.lua, so this pulls
      -- markview's code-block language icons from the same set mini.pick / mini.files /
      -- mini.tabline already use, instead of markview's bundled internal set.
      icon_provider = "mini",
      -- markview's default is 5 filetypes (markdown, quarto, rmd, typst, asciidoc). Only
      -- markdown files exist in this setup, and the FileType autocmd below only fires for
      -- markdown, so narrowing here keeps the lazy-load trigger and the decorated set in sync.
      filetypes = { "markdown" },
    },
  })
end

local function load_markview()
  return lazy.require("markview.nvim", "markview", setup)
end

vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  -- Loading once is enough: markview's own plugin/markview.lua registers BufAdd / BufEnter /
  -- BufWinEnter autocmds that pick up every markdown buffer opened after this point.
  once = true,
  desc = "Load markview.nvim on the first markdown buffer",
  callback = function()
    load_markview()
  end,
})

vim.keymap.set("n", "<Leader>im", function()
  -- Routed through load_markview() rather than assumed loaded: pressing this key in a
  -- non-markdown buffer before any markdown file has been opened would otherwise hit a
  -- nonexistent :Markview command (E492).
  load_markview()
  -- Lowercase "toggle" affects only the current buffer; uppercase "Toggle" would affect
  -- every buffer, which is not what "show me this file's raw syntax" calls for.
  vim.cmd("Markview toggle")
end, { silent = true, desc = "Toggle markdown decoration" })
