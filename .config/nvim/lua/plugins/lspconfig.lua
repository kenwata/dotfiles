-- nvim-lspconfig is a repository of per-server connection settings (command, filetypes,
-- root-marker detection), not a plugin with its own runtime behavior. Its bundled
-- plugin/lspconfig.lua early-returns once it detects that Neovim already has :lsp, so
-- registering it at startup (rather than deferring to first use) costs nothing measurable
-- (see .claude/rules/lua.md Plugins section, "startup-load exception").
vim.cmd.packadd({ args = { "nvim-lspconfig" }, bang = true })

-- lua_ls does not know about Neovim's globals (the `vim` table, bundled runtime Lua files)
-- unless told. The on_init guard below is taken as-is from nvim-lspconfig's own documented
-- example (lsp/lua_ls.lua), so that an upstream change to the recommended condition shows up
-- as a diff. Its broad apply condition (override everywhere except a workspace that carries
-- its own .luarc.json / .luarc.jsonc) was reviewed and approved as-is on 2026-09-07. The
-- settings the guard merges in are a deliberate subset of that example: it also offers
-- runtime.path and an nvim-lspconfig type-annotation directory in workspace.library, and
-- neither is adopted here (the default runtime.path already resolves this repo's lua/
-- modules, and the only settings table written below is `Lua = {}`).
--
-- Note on the `stdpath("config")` comparison: lua_ls resolves the workspace by walking up to
-- the nearest .git, so opening files under ~/.config/nvim (a symlink) still yields
-- ~/workspace/repos/dotfiles. That never equals stdpath("config"), so the comparison is
-- always true here and whether the override is skipped is decided solely by the presence of
-- .luarc.json / .luarc.jsonc in the workspace. dotfiles has neither, so the override applies.
vim.lsp.config("lua_ls", {
  on_init = function(client)
    if client.workspace_folders then
      local path = client.workspace_folders[1].name
      if
        path ~= vim.fn.stdpath("config")
        and (vim.uv.fs_stat(path .. "/.luarc.json") or vim.uv.fs_stat(path .. "/.luarc.jsonc"))
      then
        return
      end
    end

    client.config.settings.Lua = vim.tbl_deep_extend("force", client.config.settings.Lua, {
      runtime = { version = "LuaJIT" },
      workspace = {
        checkThirdParty = false,
        library = { vim.env.VIMRUNTIME },
      },
    })
  end,
  settings = {
    Lua = {},
  },
})

vim.lsp.enable({
  "rust_analyzer",
  "pyright",
  "ruff",
  "lua_ls",
  "bashls",
  "marksman",
  "ts_ls",
})
