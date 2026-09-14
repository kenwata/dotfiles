-- git-messenger.vim is loaded on first use, not at startup: :GitMessenger and
-- GitMessengerClose are the only entry points, and <leader>gm below drives GitMessenger through
-- them rather than through plugin/gitmessenger.vim's own default mapping.
return {
  "rhysd/git-messenger.vim",
  commit = "fd124457378a295a5d1036af4954b35d6b807385",
  cmd = { "GitMessenger", "GitMessengerClose" },
  keys = {
    { "<Leader>gm", "<Cmd>GitMessenger<CR>", desc = "Show commit message for line under cursor" },
  },
  -- plugin/gitmessenger.vim reads this before creating its own <Leader>gm mapping, which has
  -- no desc. Set in init (not config) so it takes effect before that plugin/ script runs.
  init = function()
    vim.g.git_messenger_no_default_mappings = true
  end,
}
