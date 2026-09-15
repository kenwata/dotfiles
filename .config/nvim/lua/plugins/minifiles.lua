-- mini.files is loaded on first use, not at startup: opening the explorer has no bearing on
-- the first frame drawn.
--
-- options.use_as_default_explorer replaces netrw for directories opened via `nvim <dir>` or
-- `:e <dir>`, but only once config() below has run. While mini.files stays lazy, that does not
-- happen until first use, so the BufEnter stub in init() covers every directory buffer opened
-- before that point.
return {
  "echasnovski/mini.files",
  version = "0.18",
  keys = {
    {
      "<Leader>e",
      function()
        local minifiles = require("mini.files")
        if not minifiles.close() then
          minifiles.open()
        end
      end,
      desc = "Toggle the file explorer",
      silent = true,
    },
  },
  init = function()
    -- vim.g.loaded_netrw alone is not enough: plugin/netrwPlugin.vim still re-registers the
    -- FileExplorer autocmd after init.lua runs (Neovim's startup order is init.lua, then
    -- plugin/, then the buffer for the command-line argument), in time for `nvim <dir>`.
    -- Disabling netrw's plugin/ file via loaded_netrwPlugin is what actually stops it.
    vim.g.loaded_netrw = 1
    vim.g.loaded_netrwPlugin = 1

    local netrw_replacement_group = vim.api.nvim_create_augroup("minifiles_netrw_replacement", { clear = true })

    vim.api.nvim_create_autocmd("BufEnter", {
      group = netrw_replacement_group,
      desc = "Open mini.files in place of netrw for the first directory buffer",
      callback = function()
        local bufname = vim.api.nvim_buf_get_name(0)
        if vim.fn.isdirectory(bufname) == 0 then
          return
        end

        -- Only the first directory buffer needs this stub; mini.files' own BufEnter (registered
        -- by config()) takes over from the second one onward. bufhidden and
        -- minifiles_processed_dir mirror what mini.files' own handler sets, so the outcome
        -- matches whichever handler ends up processing the buffer.
        vim.api.nvim_del_augroup_by_id(netrw_replacement_group)
        vim.bo.bufhidden = "wipe"
        vim.b.minifiles_processed_dir = true
        vim.schedule(function()
          -- Not an entry point reached through keys, so the load is explicit here.
          require("lazy").load({ plugins = { "mini.files" } })
          require("mini.files").open(bufname, false)
        end)
      end,
    })

    -- Buffer-local keys that mappings cannot express: <C-q> as a second way to close the
    -- explorer alongside the built-in close = 'q', and <CR> as a second key for go_in_plus
    -- alongside the built-in L. mini.files only accepts one key per action, so a second key has
    -- to be a plain buffer-local mapping instead of a mappings entry. The event fires once per
    -- explorer buffer, and only after mini.files is loaded, so require() here just returns the
    -- already-loaded module.
    vim.api.nvim_create_autocmd("User", {
      pattern = "MiniFilesBufferCreate",
      desc = "Add <C-q> to close and <CR> to confirm in the file explorer",
      callback = function(args)
        vim.keymap.set("n", "<C-q>", function()
          require("mini.files").close()
        end, { buffer = args.data.buf_id, silent = true, desc = "Close the file explorer" })

        vim.keymap.set("n", "<CR>", function()
          require("mini.files").go_in({ close_on_file = true })
        end, {
          buffer = args.data.buf_id,
          silent = true,
          desc = "Open the file and close the explorer, or enter the directory",
        })
      end,
    })
  end,
  config = function()
    require("mini.files").setup({
      options = {
        permanent_delete = true,
        use_as_default_explorer = true,
      },
      windows = {
        preview = true,
        -- Widened from the default 25 (T98, 2026-09-10). Chosen on the real Ghostty terminal
        -- from candidates 25/40/60/80 after confirming the preview column stays legible and
        -- the three columns together still fit the window width.
        width_preview = 80,
      },
    })
  end,
}
