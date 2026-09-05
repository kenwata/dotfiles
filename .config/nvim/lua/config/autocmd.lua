-- Turn on the LSP completion source for every server that attaches. Without this call,
-- vim.lsp.completion.get() is a silent no-op: it sends no request at all (measured
-- against the LSP log, 2026-09-06).
vim.api.nvim_create_autocmd("LspAttach", {
  callback = function(ev)
    vim.lsp.completion.enable(true, ev.data.client_id, ev.buf, { autotrigger = true })
  end,
})

-- 'autocomplete' only fires on typed input, so landing in Insert mode at the end of an
-- existing partial word (`a` after `std::pro`) shows nothing until the next keystroke.
-- Request candidates once on entry, but only when the cursor follows a keyword
-- character, so opening a blank line with `o` stays quiet.
vim.api.nvim_create_autocmd("InsertEnter", {
  callback = function()
    local chars_before_cursor = vim.fn.col(".") - 1
    if chars_before_cursor < 1 then
      return
    end

    local previous_char = vim.api.nvim_get_current_line():sub(chars_before_cursor, chars_before_cursor)
    if previous_char:match("[%w_]") then
      vim.lsp.completion.get()
    end
  end,
})
