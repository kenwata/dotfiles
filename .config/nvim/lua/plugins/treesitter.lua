-- nvim-treesitter (main branch) provides parser install/update/remove and the
-- filetype-to-parser-name mapping (plugin/filetypes.lua). Syntax highlighting itself is
-- Neovim core's vim.treesitter.start(), called below once the plugin is loaded.
local lazy = require("util.lazy")

-- setup()'s only role is changing install_dir, which already defaults to the directory
-- Neovim puts on runtimepath (stdpath("data") .. "/site"); calling it would just duplicate
-- that entry, so the setup callback here does nothing.
local function load_treesitter()
  return lazy.require("nvim-treesitter", "nvim-treesitter", function() end)
end

-- The four languages phase 4 set up language servers for, plus tsx (typescriptreact has its
-- own parser, distinct from typescript) and the file formats this config and its tooling
-- edit (json/toml/yaml). javascript is deliberately absent (plan.md out-of-scope).
local HIGHLIGHTED_FILETYPES = {
  "rust",
  "python",
  "typescript",
  "typescriptreact",
  "sh",
  "bash",
  "json",
  "jsonc",
  "toml",
  "yaml",
}

vim.api.nvim_create_autocmd("FileType", {
  pattern = HIGHLIGHTED_FILETYPES,
  -- Not `once`: vim.treesitter.start() must run for every buffer of every matching
  -- filetype, not only the first. lazy.require() itself keeps packadd/setup to a single run.
  desc = "Load nvim-treesitter and start treesitter highlighting",
  callback = function(args)
    load_treesitter()

    -- Three of these filetypes don't match their parser name 1:1 (sh -> bash,
    -- typescriptreact -> tsx, jsonc -> json); plugin/filetypes.lua registers that mapping,
    -- so it can only be read after the packadd above.
    local lang = vim.treesitter.language.get_lang(vim.bo[args.buf].filetype)

    -- A fresh dotfiles checkout has no parsers under stdpath("data") .. "/site" at all --
    -- they are never part of this repo or dotfiles. install() is asynchronous by default
    -- (no :wait() below), so this buffer's own highlighting is skipped for now rather than
    -- blocking on the download+compile; the next time this filetype opens, the parser is
    -- there and this branch is not taken.
    if #vim.api.nvim_get_runtime_file("parser/" .. lang .. ".so", false) == 0 then
      vim.notify(("nvim-treesitter: installing parser '%s'..."):format(lang), vim.log.levels.INFO)
      require("nvim-treesitter").install({ lang })
      return
    end

    vim.treesitter.start(args.buf, lang)

    -- Window-local, so vim.wo[0][0] (this window, this buffer) rather than the vim.o form
    -- used elsewhere in this config. foldlevelstart (lua/config/general.lua) is what keeps
    -- a freshly opened buffer fully unfolded; nothing here touches foldlevel itself.
    vim.wo[0][0].foldmethod = "expr"
    vim.wo[0][0].foldexpr = "v:lua.vim.treesitter.foldexpr()"
  end,
})

-- Markdown already gets vim.treesitter.start() from Neovim's own
-- $VIMRUNTIME/ftplugin/markdown.lua; what's missing without this plugin loaded is the
-- filetype-to-parser mapping that fenced code blocks rely on for abbreviations such as
-- ```sh or ```ts (plugin/filetypes.lua). Loading here, without calling start() a second
-- time, closes that gap.
vim.api.nvim_create_autocmd("FileType", {
  pattern = "markdown",
  desc = "Load nvim-treesitter's filetype-to-parser mapping for embedded code blocks",
  callback = function()
    load_treesitter()
  end,
})
