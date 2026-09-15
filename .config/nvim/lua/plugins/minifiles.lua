-- mini.files is loaded on first use, not at startup: opening the explorer has no bearing on
-- the first frame drawn.
--
-- options.use_as_default_explorer replaces netrw for directories opened via `nvim <dir>` or
-- `:e <dir>`, but only once config() below has run. While mini.files stays lazy, that does not
-- happen until first use, so the BufEnter stub in init() covers every directory buffer opened
-- before that point.

-- The directory `nvim` was started in, captured once in init() from the command-line arguments.
-- <Leader>e uses this (falling back to the current directory when unset) as the left edge of the
-- branch it opens, so that the explorer's root matches the one the BufEnter stub above already
-- uses for the directory nvim was launched against.
local startup_dir = nil

--- Normalizes a path the same way `mini.files` normalizes the paths it compares (`H.fs_full_path`
--- in `files.lua`): absolute, with a trailing slash removed. Comparing paths without this would
--- let relative arguments (`nvim .`), or a plain trailing slash, break the prefix match in
--- `is_inside_root` below.
---@param path string A file system path, absolute or relative to the current directory.
---@return string path The absolute path, without a trailing slash.
local function normalize_path(path)
  return (vim.fn.fnamemodify(path, ":p"):gsub("(.)/$", "%1"))
end

--- Reports whether `file` lies inside `root`, matching on the path separator so a sibling
--- directory whose name merely shares a prefix (e.g. `root2` against `root`) is not mistaken for
--- being inside.
---@param root string Absolute directory path, without a trailing slash.
---@param file string Absolute file path.
---@return boolean inside Whether `file` is `root` itself or a descendant of it.
local function is_inside_root(root, file)
  return file == root or file:sub(1, #root + 1) == root .. "/"
end

--- Builds the `mini.files` branch (the array `MiniFiles.set_branch()` expects) that leads from
--- `root` down to `file`, one entry per intermediate directory, ending with `file` itself.
---@param root string Absolute directory path, without a trailing slash. `file` must lie inside it
---   (see `is_inside_root`).
---@param file string Absolute file path inside `root`.
---@return string[] branch Directory paths from `root` to the file's parent, with `file` appended.
local function branch_from_root(root, file)
  local branch = { root }
  local relative = file:sub(#root + 2)
  local prefix = root

  for segment in relative:gmatch("[^/]+") do
    prefix = prefix .. "/" .. segment
    table.insert(branch, prefix)
  end

  return branch
end

--- Reports whether the current buffer is a file that exists on disk (as opposed to an unnamed
--- buffer, a terminal or other special buffer, or a not-yet-saved new file).
---@return boolean is_file
local function current_buffer_is_a_file()
  if vim.bo.buftype ~= "" then
    return false
  end

  local name = vim.api.nvim_buf_get_name(0)
  return name ~= "" and vim.fn.filereadable(name) == 1
end

return {
  "echasnovski/mini.files",
  version = "0.18",
  keys = {
    {
      "<Leader>e",
      function()
        local minifiles = require("mini.files")
        if minifiles.close() then
          return
        end

        local root = normalize_path(startup_dir or vim.fn.getcwd())

        if not current_buffer_is_a_file() then
          minifiles.open(root, false)
          return
        end

        local file = normalize_path(vim.api.nvim_buf_get_name(0))
        if not is_inside_root(root, file) then
          minifiles.open(file, false)
          return
        end

        minifiles.open(root, false)
        minifiles.set_branch(branch_from_root(root, file))
      end,
      desc = "Toggle the file explorer, opened on the current file",
      silent = true,
    },
  },
  init = function()
    -- vim.g.loaded_netrw alone is not enough: plugin/netrwPlugin.vim still re-registers the
    -- FileExplorer autocmd after init.lua runs (Neovim's startup order is init.lua, then
    -- plugin/, then the buffer for the command-line argument), in time for `nvim <dir>`.
    -- Disabling netrw's plugin/ file via loaded_netrwPlugin is what actually stops it.
    vim.g.loaded_netrw = 1
    vim.g.loaded_netrwPlugin = 1

    -- Captures the directory `nvim` was started against, if any, for <Leader>e above. Read from
    -- the command-line arguments rather than the BufEnter stub below: that stub only fires for
    -- the first directory buffer, which would also (wrongly) pick up a later `:e <dir>`.
    for _, arg in ipairs(vim.fn.argv()) do
      local full = normalize_path(arg)
      if vim.fn.isdirectory(full) == 1 then
        startup_dir = full
        break
      end
    end

    local netrw_replacement_group = vim.api.nvim_create_augroup("minifiles_netrw_replacement", { clear = true })

    vim.api.nvim_create_autocmd("BufEnter", {
      group = netrw_replacement_group,
      desc = "Open mini.files in place of netrw for the first directory buffer",
      callback = function()
        local bufname = vim.api.nvim_buf_get_name(0)
        if vim.fn.isdirectory(bufname) == 0 then
          return
        end

        -- Only the first directory buffer needs this stub; mini.files' own BufEnter (registered
        -- by config()) takes over from the second one onward. bufhidden and
        -- minifiles_processed_dir mirror what mini.files' own handler sets, so the outcome
        -- matches whichever handler ends up processing the buffer.
        vim.api.nvim_del_augroup_by_id(netrw_replacement_group)
        vim.bo.bufhidden = "wipe"
        vim.b.minifiles_processed_dir = true
        vim.schedule(function()
          -- Not an entry point reached through keys, so the load is explicit here.
          require("lazy").load({ plugins = { "mini.files" } })
          require("mini.files").open(bufname, false)
        end)
      end,
    })

    -- Buffer-local keys that mappings cannot express: <C-q> as a second way to close the
    -- explorer alongside the built-in close = 'q', and <CR> as a second key for go_in_plus
    -- alongside the built-in L. mini.files only accepts one key per action, so a second key has
    -- to be a plain buffer-local mapping instead of a mappings entry. The event fires once per
    -- explorer buffer, and only after mini.files is loaded, so require() here just returns the
    -- already-loaded module.
    vim.api.nvim_create_autocmd("User", {
      pattern = "MiniFilesBufferCreate",
      desc = "Add <C-q> to close and <CR> to confirm in the file explorer",
      callback = function(args)
        vim.keymap.set("n", "<C-q>", function()
          require("mini.files").close()
        end, { buffer = args.data.buf_id, silent = true, desc = "Close the file explorer" })

        vim.keymap.set("n", "<CR>", function()
          require("mini.files").go_in({ close_on_file = true })
        end, {
          buffer = args.data.buf_id,
          silent = true,
          desc = "Open the file and close the explorer, or enter the directory",
        })
      end,
    })
  end,
  config = function()
    require("mini.files").setup({
      options = {
        permanent_delete = true,
        use_as_default_explorer = true,
      },
      windows = {
        preview = true,
        -- Widened from the default 25 (T98, 2026-09-10). Chosen on the real Ghostty terminal
        -- from candidates 25/40/60/80 after confirming the preview column stays legible and
        -- the three columns together still fit the window width.
        width_preview = 80,
      },
    })
  end,
}
