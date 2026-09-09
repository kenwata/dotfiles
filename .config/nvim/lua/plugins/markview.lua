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

-- Not routed through util.lazy: that loader calls vim.cmd.packadd() without a bang, which
-- runs plugin/markview.lua (require("markview.autocmds").setup() then
-- require("markview.commands").setup()) immediately -- before setup() below has set
-- icon_provider = "mini". autocmds.setup() calls markview's own lazy_loaded() when
-- vim.v.vim_did_enter is already 1 (i.e. VimEnter has already fired), which synchronously
-- decorates every already-open markdown buffer using markview's built-in icon set. That
-- decoration is not refreshed by a later CursorMoved -- only a full re-attach
-- (:Markview toggle twice) forces it. Measured for T79: opening a markdown buffer via :e
-- after startup left the code-block sign highlighted "MarkviewPalette5Sign" instead of
-- "MiniIconsAzure", even after moving the cursor.
--
-- packadd! (bang) skips plugin/ entirely (:help repeat.txt, :packadd!), so setup() below
-- runs first and the same two calls plugin/markview.lua would have made run after, with
-- icon_provider already "mini".
local function load_markview()
  if not package.loaded["markview"] then
    vim.cmd.packadd({ args = { "markview.nvim" }, bang = true })
    setup(require("markview"))
    require("markview.autocmds").setup()
    require("markview.commands").setup()
  end

  return require("markview")
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
