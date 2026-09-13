local lazy = require("common.lazy")

--- Applies this config's autopairs settings.
---@param npairs table
local function setup(npairs)
  npairs.setup({
    -- <C-h> has no mapping of its own in Neovim's Insert mode (`nvim --clean --headless` imap
    -- dump has none), so this only adds behavior: deleting both characters of a pair at once
    -- when the cursor sits right between them, on top of the plain single-character deletion
    -- it already did.
    map_c_h = true,
    -- fastwrap.lua already defaults `map` to <M-e>; written out because choosing that key is
    -- this config's decision, not an unexamined default.
    fast_wrap = { map = "<M-e>" },
    -- The plugin's own defaults (TelescopePrompt, spectre_panel, snacks_picker_input) plus
    -- minifiles: mini.files rewrites the buffer's text as filenames for renaming, so typing a
    -- single "(" there would otherwise become "()".
    disable_filetype = { "TelescopePrompt", "spectre_panel", "snacks_picker_input", "minifiles" },
    -- map_cr (default true) stays on: pressing Enter right after "{" should push the closing
    -- brace to its own line and land the cursor on the blank line between them.
    --
    -- map_c_w (default false) stays off: nvim-autopairs sends <c-g>U<c-w> for it, and <C-g>U
    -- tells Neovim not to break the undo sequence on the next cursor move -- the opposite of
    -- Neovim's own <C-W>, which sends <C-g>u (do break it). Turning this on would make every
    -- word deletion share an undo step with whatever came before it, unlike Neovim's default.
  })

  npairs.add_rules(require("nvim-autopairs.rules.endwise-lua"))
end

vim.api.nvim_create_autocmd("InsertEnter", {
  once = true,
  desc = "Load nvim-autopairs on first entering Insert mode",
  callback = function()
    lazy.require("nvim-autopairs", "nvim-autopairs", setup)
  end,
})
