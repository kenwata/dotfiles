-- markview.nvim is loaded on first use, not at startup: decorating markdown has no bearing
-- on the first frame drawn (plan.md §6). Unlike every other lazy-loaded plugin here, it has
-- no single key that means "start using this now" -- opening a markdown buffer is itself the
-- moment decoration becomes relevant, so ft = "markdown" below is the primary entry point.
-- <Leader>im additionally covers toggling decoration from a key.
return {
  "OXY2DEV/markview.nvim",
  version = "28",
  ft = "markdown",
  keys = {
    {
      "<Leader>im",
      function()
        -- Lowercase "toggle" affects only the current buffer; uppercase "Toggle" would affect
        -- every buffer, which is not what "show me this file's raw syntax" calls for.
        vim.cmd("Markview toggle")
      end,
      desc = "Toggle markdown decoration",
      silent = true,
    },
  },
  init = function()
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
    --
    -- Only a normal file buffer (buftype == "") is in scope. markview only ever decorates that
    -- kind of buffer, and every other kind already has an owner deciding 'list' on its own: a
    -- terminal is decided by Neovim itself (TermOpen sets it false), and quickfix / nofile
    -- buffers are decided by whichever plugin opened them. Writing the global value on top of
    -- those fights the owner that already set it -- reopening a closed terminal re-entered this
    -- window and got overwritten back to true (T97, 2026-09-10).
    local function sync_list(window, buffer)
      if vim.bo[buffer].buftype ~= "" then
        return
      end

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
  end,
  config = function()
    -- Only preview.icon_provider, preview.filetypes and markdown_inline.tags are set below;
    -- every other preview.* option (20+) and every other filetype-specific config (markdown,
    -- html, yaml, latex, typst, asciidoc, comment, and the rest of markdown_inline) is left at
    -- its default.
    require("markview").setup({
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
        -- markdown files exist in this setup, and ft = "markdown" above only fires for
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
  end,
}
