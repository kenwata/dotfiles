# Neovim Configuration

`~/.config/nvim` is a symlink to this directory
(`~/workspace/repos/dotfiles/.config/nvim`). Neovim reads the config through that
symlink.

## Layout

```
.config/nvim/
├── README.md            # This file
├── init.lua              # Loader only: sets the leader key, requires the modules below
└── lua/
    └── config/
        ├── general.lua    # Editor options (UI, indent, search, clipboard)
        ├── keybind.lua     # Key mappings
        └── autocmd.lua     # Autocommands
```

- `init.lua`: sets `vim.g.mapleader`, then `require`s each module in `lua/config/`.
- `lua/config/general.lua`: `vim.o`/`vim.opt` settings, grouped by section comment.
- `lua/config/keybind.lua`: `vim.keymap.set` mappings, each with an English `desc`.
- `lua/config/autocmd.lua`: `vim.api.nvim_create_autocmd` entries (currently empty).
