-- nvim-lspconfig is a repository of per-server connection settings (command, filetypes,
-- root-marker detection), not a plugin with its own runtime behavior. Its bundled
-- plugin/lspconfig.lua early-returns once it detects that Neovim already has :lsp, so
-- registering it at startup (rather than deferring to first use) costs nothing measurable
-- (see .claude/rules/lua.md Plugins section, "startup-load exception").
vim.cmd.packadd({ args = { "nvim-lspconfig" }, bang = true })

-- lua_ls does not know about Neovim's globals (the `vim` table, bundled runtime Lua files)
-- unless told. This mirrors nvim-lspconfig's own documented example (lsp/lua_ls.lua), so
-- that it still leaves projects with their own .luarc.json alone.
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
