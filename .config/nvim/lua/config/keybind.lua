-- Insert mode cursor movement
vim.keymap.set("i", "jj", "<Esc>", { silent = true, desc = "Exit insert mode" })
-- Same finger motion as the insert-mode jj: leave terminal mode and go back to the window
-- that was active before the terminal (a bare <C-\><C-n> would leave the cursor in the
-- terminal window). Like the insert-mode jj, a lone j is held back until the next key or
-- timeoutlen expires.
vim.keymap.set("t", "jj", [[<C-\><C-n><C-w>p]], { silent = true, desc = "Exit terminal mode to previous window" })
-- Emacs-style movement. <C-j> and <C-l> stay unbound: <C-j> inserts a line break and Emacs
-- gives <C-l> nothing worth taking here. <C-b> and <C-f> have no default insert-mode binding.
-- The rest take over one: <C-n>/<C-p> start keyword completion, <C-a> re-inserts the previously
-- inserted text and <C-e> copies the character from the line below. All three were judged worth
-- less than reaching the cursor without leaving the home row.
-- <C-n>, <C-p> and <C-e> dismiss the completion menu before moving, because while it is open
-- <Down> and <Up> walk the candidate list rather than the buffer. The <C-e> they send for that
-- is the built-in one: these mappings are non-recursive, so what they return is not looked up
-- again -- which is why <C-e> can dismiss the menu and still be <End> on its own. Measured
-- against a real popup: pumvisible() goes 1 to 0 and the line is left untouched, so no
-- candidate is taken by accident. Opening the menu by hand is <C-Space> further down.
vim.keymap.set("i", "<C-b>", "<Left>", { silent = true, desc = "Move cursor left" })
vim.keymap.set("i", "<C-f>", "<Right>", { silent = true, desc = "Move cursor right" })
vim.keymap.set("i", "<C-p>", function()
  return vim.fn.pumvisible() == 1 and "<C-e><Up>" or "<Up>"
end, { expr = true, silent = true, desc = "Move cursor up" })
vim.keymap.set("i", "<C-n>", function()
  return vim.fn.pumvisible() == 1 and "<C-e><Down>" or "<Down>"
end, { expr = true, silent = true, desc = "Move cursor down" })
vim.keymap.set("i", "<C-a>", "<Home>", { silent = true, desc = "Move cursor to start of line" })
vim.keymap.set("i", "<C-e>", function()
  return vim.fn.pumvisible() == 1 and "<C-e><End>" or "<End>"
end, { expr = true, silent = true, desc = "Move cursor to end of line" })
vim.keymap.set("i", "<M-b>", "<S-Left>", { silent = true, desc = "Move cursor one word back" })
vim.keymap.set("i", "<M-f>", "<S-Right>", { silent = true, desc = "Move cursor one word forward" })

-- Emacs-style deletion, sent as repeated <Del>/<BS> rather than written straight into the
-- buffer: an API edit made from inside Insert mode leaves the undo history unusable (pressing u
-- afterwards restored nothing, measured), while these keys travel the same path as ordinary
-- typing. Each run starts with <C-g>u so the deletion is its own undo step, which is what
-- Neovim's own <C-u>/<C-w> defaults do and what replacing <C-u> would otherwise throw away.
-- What these take over: <C-d> unindents by one shiftwidth and <C-k> starts a digraph. <C-h>
-- (character before the cursor) and <C-w> (word before the cursor) already behave the Emacs way
-- and are left alone.
local function delete_keys(key, count)
  if count <= 0 then
    return ""
  end

  return "<C-g>u" .. string.rep(key, count)
end

-- col(".") and getline(".") rather than the nvim_win_* API: inside an expr mapping the API
-- still reports the state from before the keys being typed, which counted the deletions
-- against a stale line (measured).
local function delete_to_end_of_line()
  local after_cursor = vim.fn.getline("."):sub(vim.fn.col("."))

  return delete_keys("<Del>", vim.fn.strchars(after_cursor))
end

local function delete_to_start_of_line()
  local before_cursor = vim.fn.getline("."):sub(1, vim.fn.col(".") - 1)

  return delete_keys("<BS>", vim.fn.strchars(before_cursor))
end

-- Everything up to and including the next run of keyword characters, so that punctuation
-- between the cursor and the word goes with it. \k follows 'iskeyword', which each filetype
-- sets for itself.
local NEXT_WORD_PATTERN = [[\%(\k\@!.\)*\k\+]]

local function delete_next_word()
  local after_cursor = vim.fn.getline("."):sub(vim.fn.col("."))
  local stop = vim.fn.matchend(after_cursor, NEXT_WORD_PATTERN)
  if stop < 0 then
    return ""
  end

  return delete_keys("<Del>", vim.fn.strchars(after_cursor:sub(1, stop)))
end

vim.keymap.set("i", "<C-d>", "<Del>", { silent = true, desc = "Delete character under cursor" })
vim.keymap.set("i", "<C-k>", delete_to_end_of_line, { expr = true, silent = true, desc = "Delete to end of line" })
vim.keymap.set("i", "<C-u>", delete_to_start_of_line, { expr = true, silent = true, desc = "Delete to start of line" })
vim.keymap.set("i", "<M-d>", delete_next_word, { expr = true, silent = true, desc = "Delete next word" })

-- Completion menu
-- The menu opens on its own except where the cursor sits inside an existing word (see
-- config.autocmd), so <C-Space> covers the places it stays away from: i_CTRL-N gathers from
-- every source in 'complete', the language server included, whether or not 'autocomplete' is
-- on. Accepting a candidate stays on the built-in <C-y>.
vim.keymap.set("i", "<C-Space>", "<C-n>", { silent = true, desc = "Open the completion menu" })

-- Neovim maps <Tab>/<S-Tab> to jump between snippet placeholders, so walking the candidate
-- list has to be folded into that rather than replace it: menu first, then the snippet jump
-- exactly as :help default-mappings defines it, then a plain <Tab>. Select mode is included
-- because a snippet leaves the placeholder text selected.
vim.keymap.set({ "i", "s" }, "<Tab>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-n>"
  end
  if vim.snippet.active({ direction = 1 }) then
    return "<Cmd>lua vim.snippet.jump(1)<CR>"
  end
  return "<Tab>"
end, { expr = true, silent = true, desc = "Next completion candidate, else snippet jump, else <Tab>" })
vim.keymap.set({ "i", "s" }, "<S-Tab>", function()
  if vim.fn.pumvisible() == 1 then
    return "<C-p>"
  end
  if vim.snippet.active({ direction = -1 }) then
    return "<Cmd>lua vim.snippet.jump(-1)<CR>"
  end
  return "<S-Tab>"
end, { expr = true, silent = true, desc = "Previous completion candidate, else snippet jump, else <S-Tab>" })

-- Search
-- Recentre on the match that was jumped to: it can land anywhere in the window, and zz puts it
-- in the middle so the surrounding lines are visible without a second keystroke. Clearing the
-- search highlight has no mapping here because the built-in <C-l> already does it, together
-- with a redraw and a diff refresh.
vim.keymap.set("n", "n", "nzz", { silent = true, desc = "Next search match, centred" })
vim.keymap.set("n", "N", "Nzz", { silent = true, desc = "Previous search match, centred" })

-- Command line
-- Reaching : without holding Shift, which is the whole point. What it costs is ; as "repeat
-- the last f/t search forwards"; , still repeats that search backwards.
vim.keymap.set("n", ";", ":", { desc = "Open the command line" })

-- Display-line movement
vim.keymap.set("n", "j", "gj", { silent = true, desc = "Move down by display line" })
vim.keymap.set("n", "k", "gk", { silent = true, desc = "Move up by display line" })

-- Indent
-- Restore the selection after shifting it, so < or > can be pressed again for a second level.
-- The built-in behaviour drops the selection after one shift and needs gv to get it back.
vim.keymap.set("x", "<", "<gv", { silent = true, desc = "Shift left and keep the selection" })
vim.keymap.set("x", ">", ">gv", { silent = true, desc = "Shift right and keep the selection" })

-- Window split
-- The s-prefixed maps below take over s, which deletes the character under the cursor and
-- enters insert mode; cl does exactly the same thing and r covers a plain one-character
-- replacement, while splitting and moving between windows is reached far more often, so
-- the override is accepted.
vim.keymap.set("n", "ss", "<C-w>s", { silent = true, desc = "Split window horizontally" })
vim.keymap.set("n", "sv", "<C-w>v", { silent = true, desc = "Split window vertically" })

-- Window navigation
vim.keymap.set("n", "sh", "<C-w>h", { silent = true, desc = "Go to the left window" })
vim.keymap.set("n", "sl", "<C-w>l", { silent = true, desc = "Go to the right window" })
vim.keymap.set("n", "sj", "<C-w>j", { silent = true, desc = "Go to the window below" })
vim.keymap.set("n", "sk", "<C-w>k", { silent = true, desc = "Go to the window above" })

-- LSP display toggles
-- Inlay hints stay off by default and are switched on for the moment they are wanted. They
-- render parameter names inline (nvim_create_autocmd(event: "...", opts: {...})), which reads
-- well when an API takes several positional arguments and gets in the way otherwise, since the
-- inserted text pushes the real code right and 'wrap' then folds the line.
vim.keymap.set("n", "<leader>ih", function()
  vim.lsp.inlay_hint.enable(not vim.lsp.inlay_hint.is_enabled())
end, { silent = true, desc = "Toggle inlay hints" })
