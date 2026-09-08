-- Autocommands live here.

-- Flash the yanked region so it is clear what was copied.
-- DiffText rather than Search, though both carry the same yellow #fabd2f in this colorscheme:
-- Search defines it as a foreground with reverse=true, and where listchars draws a space as
-- "·" that cell is painted by Whitespace, which has a foreground only. Reversing there swaps
-- in Whitespace's grey instead of the yellow, so spaces stayed unlit -- observed on screen.
-- DiffText carries the yellow as an actual background, which covers spaces as well.
-- 300ms rather than the 150 default of vim.hl.on_yank: at 150 the flash was easy to miss.
-- The value matches the example in :help vim.hl.on_yank().
local YANK_FLASH_MS = 300

vim.api.nvim_create_autocmd("TextYankPost", {
  desc = "Highlight the yanked region",
  callback = function()
    vim.hl.on_yank({ higroup = "DiffText", timeout = YANK_FLASH_MS })
  end,
})

-- Code lenses are the one LSP display Neovim never refreshes on its own: the server sends
-- them, but nothing asks for them, so nothing is drawn and grx (run code lens) does nothing.
-- Refresh on attach and whenever the buffer settles, which is the point at which reference
-- counts and test-runner lenses could have changed.
-- Scoped to buffers whose server advertises codeLensProvider, so nothing fires for the rest.
vim.api.nvim_create_autocmd("LspAttach", {
  desc = "Keep code lenses refreshed while a server that provides them is attached",
  callback = function(args)
    local client = vim.lsp.get_client_by_id(args.data.client_id)
    if not client or not client.server_capabilities.codeLensProvider then
      return
    end

    vim.lsp.codelens.refresh({ bufnr = args.buf })

    vim.api.nvim_create_autocmd({ "BufEnter", "BufWritePost", "InsertLeave" }, {
      desc = "Refresh code lenses for this buffer",
      buffer = args.buf,
      callback = function()
        vim.lsp.codelens.refresh({ bufnr = args.buf })
      end,
    })
  end,
})
