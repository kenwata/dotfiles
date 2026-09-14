return {
  "windwp/nvim-autopairs",
  commit = "430522f95fe4fb7c511ec64f8c1a90cc6a66c05c",
  -- nvim-autopairs is loaded on first entering Insert mode, not at startup: pairing has no
  -- bearing on the first frame drawn, and Insert mode is the first moment it can act.
  event = "InsertEnter",
  config = function()
    local npairs = require("nvim-autopairs")

    npairs.setup({
      -- <C-h> has no mapping of its own in Neovim's Insert mode (`nvim --clean --headless` imap
      -- dump has none), so this only adds behavior: deleting both characters of a pair at once
      -- when the cursor sits right between them, on top of the plain single-character deletion
      -- it already did.
      map_c_h = true,
      fast_wrap = {
        -- fastwrap.lua already defaults `map` to <M-e>; written out because choosing that key
        -- is this config's decision, not an unexamined default.
        map = "<M-e>",
        -- Picked by the user on the real Ghostty terminal (T110, 2026-09-13) out of three
        -- patterns laid out in the planning repository's
        -- docs/design/nvim-autopairs-lazy-pairing.md: default (Search / Comment), emphasis
        -- (IncSearch / NonText) and overlay (default colors, no virtual line). Emphasis won.
        highlight = "IncSearch",
        highlight_grey = "NonText",
        -- Also part of the emphasis pattern, even though it matches fastwrap.lua's own default:
        -- the marker renders on a virtual line below the cursor line rather than overlaid onto
        -- it.
        use_virt_lines = true,
      },
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
  end,
}
