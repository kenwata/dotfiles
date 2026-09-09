-- markview.nvim is loaded on first use, not at startup: decorating markdown has no bearing
-- on the first frame drawn (plan.md §6). Unlike every other lazy-loaded plugin here, it has
-- no key that means "start using this now" -- opening a markdown buffer is itself the moment
-- decoration becomes relevant, so the entry point is a FileType autocmd rather than a key.
--
-- Only preview.icon_provider, preview.filetypes and markdown_inline.tags are set below;
-- every other preview.* option (20+) and every other filetype-specific config (markdown,
-- html, yaml, latex, typst, asciidoc, comment, and the rest of markdown_inline) is left at
-- its default.
local function setup(markview)
  markview.setup({
    preview = {
      -- markview's own default. The "mini" provider was tried (mini.icons, matching
      -- mini.pick / mini.files / mini.tabline's icon set) but a tagless fenced code block
      -- (``` with no language after it) has item.language == nil, and
      -- mini.icons.get("filetype", nil) throws; markview's renderer swallows that error,
      -- leaving the whole block undecorated. "internal" falls back to its own "nosyntax"
      -- style on a nil language instead of throwing, so tagless blocks render like any
      -- other code block (T80, 2026-09-09).
      icon_provider = "internal",
      -- markview's default is 5 filetypes (markdown, quarto, rmd, typst, asciidoc). Only
      -- markdown files exist in this setup, and the FileType autocmd below only fires for
      -- markdown, so narrowing here keeps the lazy-load trigger and the decorated set in sync.
      filetypes = { "markdown" },
    },
    markdown_inline = {
      -- Off because the planning documents edited with this setup write #16 / #16-1 as
      -- plan and task ids, never as tags. markview conceals a tag's leading "#" and pads
      -- what is left with a space on each side, so the cell renders one column wider than
      -- its source text -- and inside a table that pushes every column to its right out of
      -- line. Measured for T80: every data row of both tables in the project's TODO.md sat
      -- exactly one cell right of its header row, and turning this off lined all of them
      -- up. Nothing in those documents is written as a tag on purpose, so no wanted
      -- decoration is lost.
      tags = { enable = false },
    },
  })
end

local lazy = require("util.lazy")

-- Routed through the shared util.lazy loader (bang-less packadd -- runs plugin/markview.lua,
-- i.e. autocmds.setup() then commands.setup(), before setup() above). T79 needed a bang-ed
-- packadd + manual setup() ordering instead, because switching icon_provider away from
-- markview's default ("internal") meant the very first synchronous render (autocmds.setup()
-- calling markview's lazy_loaded() when vim.v.vim_did_enter is already 1) used whatever
-- icon_provider was in effect before setup() ran. Now that icon_provider stays "internal" --
-- the same value before and after setup() -- that first render already matches setup()'s
-- configuration, so the ordering workaround is unnecessary (verified headless, T80).
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

-- The space dots and eol arrows of 'list' (config/general.lua) earn their place while
-- editing and turn into noise once markview draws a document. They come off exactly while a
-- decorated view is on screen: markview enabled, and the cursor not in insert or replace
-- mode. Every other state restores the global 'list' rather than a per-window value the
-- window used to hold, because this config decides 'list' in exactly one place.
--
-- Insert and replace mode have to be watched on their own. markview leaves conceallevel at
-- 3 in both and lets 'concealcursor' -- built from preview.modes, which has neither in it --
-- expose the cursor line alone, so entering them fires none of the User events below.
--
-- 'list' is window-local, so a window that once showed a decorated buffer would otherwise
-- keep the listchars hidden for whatever opens in it next; BufWinEnter puts them back. A
-- window made by :split inherits 'list' from the window it came from but no window-local
-- variables, which is why nothing here is remembered per window.
--
-- Written through nvim_set_option_value with an explicit local scope: `vim.wo[win].list = x`
-- writes the global value too (measured -- vim.go.list read false after one such assignment),
-- which would destroy the very baseline this function restores from.
local function sync_list(window, buffer)
  local mode = vim.api.nvim_get_mode().mode
  local editing = vim.startswith(mode, "i") or vim.startswith(mode, "R")
  local decorated = vim.b[buffer].markview_decorated == true

  vim.api.nvim_set_option_value("list", not (decorated and not editing) and vim.go.list, {
    scope = "local",
    win = window,
  })
end

for event, decorated in pairs({
  MarkviewAttach = true,
  MarkviewEnable = true,
  MarkviewDisable = false,
  MarkviewDetach = false,
}) do
  vim.api.nvim_create_autocmd("User", {
    pattern = event,
    desc = "Hide listchars while markview decorates the buffer",
    callback = function(args)
      vim.b[args.data.buffer].markview_decorated = decorated

      for _, window in ipairs(args.data.windows) do
        sync_list(window, args.data.buffer)
      end
    end,
  })
end

vim.api.nvim_create_autocmd("ModeChanged", {
  pattern = { "*:[iR]*", "[iR]*:*" },
  desc = "Bring listchars back while editing a decorated buffer",
  callback = function(args)
    sync_list(vim.api.nvim_get_current_win(), args.buf)
  end,
})

vim.api.nvim_create_autocmd("BufWinEnter", {
  desc = "Restore listchars when a decorated buffer leaves the window",
  callback = function(args)
    sync_list(vim.api.nvim_get_current_win(), args.buf)
  end,
})
