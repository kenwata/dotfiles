-- Shared loader for lazy-loaded plugins (.claude/rules/lua.md: extracted on the third caller).

local M = {}

---@alias common.lazy.Setup fun(module: table)

--- Loads `pack_name` and requires `module_name` on first use, running `setup` exactly once.
---
--- While `package.loaded[module_name]` is already filled, neither `packadd` nor `setup` runs
--- again; the already-loaded module is returned as-is.
---@param pack_name string Directory name passed to `vim.cmd.packadd`.
---@param module_name string Module name passed to `require`.
---@param setup common.lazy.Setup Receives the freshly required module and applies its configuration.
---@return table
function M.require(pack_name, module_name, setup)
  if not package.loaded[module_name] then
    vim.cmd.packadd(pack_name)
    setup(require(module_name))
  end

  return require(module_name)
end

return M
