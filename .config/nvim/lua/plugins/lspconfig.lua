-- nvim-lspconfig is a repository of per-server connection settings (command, filetypes,
-- root-marker detection), not a plugin with its own runtime behavior. Its bundled
-- plugin/lspconfig.lua early-returns once it detects that Neovim already has :lsp, so
-- loading it at startup (rather than deferring to first use) costs nothing measurable
-- (see .claude/rules/lua.md Plugins section, "startup-load exception").
return {
  "neovim/nvim-lspconfig",
  version = "2",
  lazy = false,
  config = function()
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
    -- Note on the `stdpath("config")` comparison: with the markers below the workspace resolves
    -- to the Neovim config directory, reached either through the ~/.config/nvim symlink or as
    -- the real path under dotfiles. The first spelling equals stdpath("config") and the second
    -- does not, so the comparison alone no longer decides anything; what does is that neither
    -- .luarc.json nor .luarc.jsonc exists there, which leaves the override applying in both cases.
    --
    -- Keep the workspace at the config directory rather than the whole dotfiles repository.
    -- Upstream's marker list ends in ".git" and ~/.config/nvim carries none of the earlier
    -- markers, so the search used to walk up to the dotfiles root -- a tree of some 6,000 files
    -- outside .git -- to reach the 9 Lua ones. Loading that workspace took 6.3s cold and still 4.9s on a third
    -- run, and until it finished there was no semantic highlighting and no diagnostics.
    -- lazy-lock.json exists only at the config root, so it stops the search there; ".git"
    -- stays last so any other Lua project resolves as before.
    local LUA_LS_ROOT_MARKERS = { ".luarc.json", ".luarc.jsonc", "lazy-lock.json", ".git" }

    vim.lsp.config("lua_ls", {
      root_markers = LUA_LS_ROOT_MARKERS,
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
  end,
}
