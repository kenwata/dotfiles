-- Bootstraps lazy.nvim on first run, then hands every plugin declared under lua/plugins/ to
-- it. Kept separate from init.lua so require("config.lazy") is the single line init.lua needs
-- for plugin management (docs/design/vim-pack-to-lazy-nvim-migration.md "移行後のファイル構成").
--
-- Taken from lazy.nvim's own documented bootstrap (doc/lazy.nvim.txt, SINGLE FILE SETUP), with
-- the clone path built through stdpath rather than hardcoded (.claude/rules/lua.md Paths section).
local lazypath = vim.fs.joinpath(vim.fn.stdpath("data"), "lazy", "lazy.nvim")

if not vim.uv.fs_stat(lazypath) then
  local out = vim.fn.system({
    "git",
    "clone",
    "--filter=blob:none",
    "--branch=stable",
    "https://github.com/folke/lazy.nvim.git",
    lazypath,
  })
  if vim.v.shell_error ~= 0 then
    vim.api.nvim_echo({
      { "Failed to clone lazy.nvim:\n", "ErrorMsg" },
      { out, "WarningMsg" },
      { "\nPress any key to exit..." },
    }, true, {})
    vim.fn.getchar()
    os.exit(1)
  end
end

vim.opt.rtp:prepend(lazypath)

-- Only the four options below are decided by this phase (same convention as
-- lua/plugins/toggleterm.lua: everything else keeps lazy.nvim's default, for these reasons).
-- - checker.enabled stays false: plugin updates stay manual (:Lazy update), never auto-checked.
-- - install.missing stays true: a fresh clone on another machine installs every plugin at the
--   revision lazy-lock.json records (lua/lazy/core/loader.lua:84).
-- - performance.rtp.reset stays true: it narrows runtimepath to stdpath("config"),
--   stdpath("data") .. "/site", lazy.nvim itself, $VIMRUNTIME, Neovim's own lib/nvim, and
--   stdpath("config") .. "/after" (lua/lazy/core/config.lua:306-313); nothing this machine
--   relies on sits outside that set (checked 2026-09-14).
require("lazy").setup({
  -- Reads every lua/plugins/*.lua as a spec, matching the one-file-per-plugin layout already
  -- in place.
  spec = { { import = "plugins" } },
  -- None of the 15 plugins under lua/plugins/ needs a luarocks package (confirmed by reading
  -- each one's rockspec before this migration), so the luarocks/hererocks health check that
  -- rocks.enabled = true would otherwise run is unnecessary here.
  rocks = { enabled = false },
  -- Shown on the very first install instead of the default habamax, so the first frame this
  -- config ever draws already uses its own colorscheme.
  install = { colorscheme = { "gruvbox" } },
  -- Off: editing dotfiles from outside this Neovim session (e.g. Claude Code) would otherwise
  -- pop a "config changed, reload?" notification and re-read specs mid-edit. A config change
  -- applies on the next :restart instead.
  change_detection = { enabled = false },
})
