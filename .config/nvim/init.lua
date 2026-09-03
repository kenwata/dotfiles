-- The leader key is expanded when a mapping is defined, not when it is pressed,
-- so it must be set before any module that defines a <leader> mapping.
vim.g.mapleader = " "

require("config.general")
require("config.keybind")
require("config.autocmd")
