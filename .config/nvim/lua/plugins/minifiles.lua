local lazy = require("util.lazy")

-- mini.files is loaded on first use, not at startup: opening the explorer has no bearing on
-- the first frame drawn.
--
-- options.use_as_default_explorer replaces netrw for directories opened via `nvim <dir>` or
-- `:e <dir>`, but only once setup() has run. While mini.files stays lazy, setup() does not
-- run until <Leader>e is pressed, so this option has no effect yet; wiring the netrw
-- replacement through a BufEnter stub that survives lazy loading is a separate task.
local function setup(minifiles)
  minifiles.setup({
    options = {
      permanent_delete = true,
      use_as_default_explorer = true,
    },
  })
end

local function load_minifiles()
  return lazy.require("mini.files", "mini.files", setup)
end

vim.keymap.set("n", "<Leader>e", function()
  local minifiles = load_minifiles()
  if not minifiles.close() then
    minifiles.open()
  end
end, { silent = true, desc = "Toggle the file explorer" })
