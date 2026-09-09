# Neovim Configuration

`~/.config/nvim` is a symlink to this directory
(`~/workspace/repos/dotfiles/.config/nvim`). Neovim reads the config through that
symlink.

## Layout

```
.config/nvim/
├── README.md              # This file
├── init.lua                # Loader only: sets the leader key, requires the modules below
├── nvim-pack-lock.json     # vim.pack lockfile (installed plugin revisions); never edit by hand
├── ripgreprc               # rg config, applied only while <leader>ff/<leader>fg run (not the shell's rg)
└── lua/
    ├── config/
    │   ├── general.lua     # Editor options (UI, window, indent, search, editing, timing, clipboard, etc.)
    │   ├── keybind.lua      # Key mappings
    │   └── autocmd.lua      # Autocommands
    ├── plugins/
    │   ├── init.lua        # vim.pack.add() (single call, deferred load), then requires below
    │   ├── claudecode.lua  # coder/claudecode.nvim config, lazy-loaded on first <leader>a* key
    │   ├── gruvbox.lua     # ellisonleao/gruvbox.nvim config, loaded at startup (colorscheme)
    │   ├── lspconfig.lua   # nvim-lspconfig registration and vim.lsp.enable() for 7 servers
    │   ├── miniclue.lua    # echasnovski/mini.clue config, lazy-loaded on first trigger key
    │   ├── minifiles.lua   # echasnovski/mini.files config, lazy-loaded on first <leader>e press
    │   ├── miniicons.lua   # echasnovski/mini.icons config, loaded at startup (icon provider)
    │   ├── minipick.lua    # echasnovski/mini.pick config, lazy-loaded on first <leader>ff/fg/fb or vim.ui.select
    │   └── minitabline.lua # echasnovski/mini.tabline config, loaded at startup (tabline)
    └── util/
        └── lazy.lua        # Shared packadd-then-setup-once loader for lazy-loaded plugins
```

- `init.lua`: calls `vim.loader.enable()` first (the bytecode cache only covers modules
  `require`d after it), sets `vim.g.mapleader`, then `require`s each module in `lua/config/`,
  then `require("plugins")`.
- `lua/config/general.lua`: `vim.o`/`vim.opt` settings, grouped by section comment.
- `lua/config/keybind.lua`: `vim.keymap.set` mappings, each with an English `desc`. Covers
  leaving Insert/Terminal mode (`jj`), Emacs-style cursor movement and deletion in Insert mode,
  the completion menu, search (recentring on `n`/`N`, `;` for the command line), display-line
  and window movement, keeping the Visual selection across an indent, and the inlay-hint toggle.
- `lua/config/autocmd.lua`: `vim.api.nvim_create_autocmd` entries, plus one-shot switches for
  LSP displays Neovim leaves off. Flashes the yanked region on `TextYankPost`; enables code
  lenses for every buffer with `vim.lsp.codelens.enable(true)`; and holds back the built-in
  `'autocomplete'` menu while the cursor sits inside an existing word (`InsertEnter`,
  `CursorMovedI`). A `TermOpen` entry clears `'buflisted'` on every terminal buffer, which
  keeps terminals out of the buffer list as a whole — `:ls`, `[b`/`]b`, `<leader>fb` and the
  tabline alike; `:ls!` still lists them.
- `lua/plugins/init.lua`: declares every plugin in a single `vim.pack.add({...})` call with
  `load = function() end` (deferred), then `require`s each per-plugin config file below.
- `lua/plugins/claudecode.lua`: config for `coder/claudecode.nvim`. Not loaded at startup;
  every `<leader>a*` key (toggle, focus, resume, continue, model, add buffer, send selection,
  accept/deny diff) runs `vim.cmd.packadd()` and `setup()` on first press, so no single key has
  to come first. `<C-q>` in terminal mode closes the Claude window without being an entry point.
- `lua/plugins/gruvbox.lua`: config for `ellisonleao/gruvbox.nvim` (colorscheme). Unlike
  `claudecode.lua` and `minipick.lua`, this one is loaded at startup with `packadd!`, because a
  colorscheme affects the first frame drawn and deferring it would leave the default colors on
  screen until something triggered the load. Sets `background` to `dark`, passes every option
  the plugin accepts to `setup()` (each one chosen by looking at the result on screen), then
  applies it with `:colorscheme`.
- `lua/plugins/lspconfig.lua`: loads `nvim-lspconfig` at startup with `packadd!` (a pure
  configuration-data repository, not a runtime plugin, so this costs nothing measurable),
  overrides `lua_ls` to recognize Neovim's `vim` global and runtime files, and enables the
  7 language servers listed below with `vim.lsp.enable()`. The `lua_ls` override applies to
  every Lua workspace except one that carries its own `.luarc.json` / `.luarc.jsonc`, which
  is the opt-out; the header comment in that file explains why the condition is that broad.
  Every other setting each server receives comes from nvim-lspconfig's own `lsp/*.lua` and is
  deliberately left untouched.
- `lua/plugins/miniclue.lua`: config for `echasnovski/mini.clue` (shows the next available
  keys and their descriptions in a floating window after a prefix key is held). Not loaded
  at startup; 19 key/mode combinations (`<Leader>`, `g`, `s`, `z`, `[`/`]`, `<C-w>`, `"`, `'`,
  `` ` ``, `<C-x>`) each carry a global `<nowait>` stub that deletes every stub, loads
  `mini.clue` through `lua/util/lazy.lua`, then replays the key so mini.clue's own
  (buffer-local) trigger takes over from the second press onward. The clue window appears
  after a 300ms delay.
- `lua/plugins/minifiles.lua`: config for `echasnovski/mini.files` (file explorer: browse,
  create, rename, move, and delete files by editing a buffer). Not loaded at startup;
  `<Leader>e` toggles it open/closed through `lua/util/lazy.lua`, opening at the current
  working directory. Also replaces netrw as the explorer that appears when a directory is
  opened (`nvim <dir>` or `:e <dir>`): `vim.g.loaded_netrw`/`loaded_netrwPlugin` disable netrw
  at startup, and a `BufEnter` stub opens `mini.files` for the first directory buffer before
  the plugin itself is loaded (its own `BufEnter`, registered by `setup()`, handles every one
  after that). Deletion is permanent (`options.permanent_delete = true`, no trash/recycle bin).
- `lua/plugins/miniicons.lua`: config for `echasnovski/mini.icons` (icon and highlight-group
  provider; draws nothing itself). Loaded at startup with `packadd!`, for the same reason as
  `gruvbox.lua` and `minitabline.lua` below: `mini.tabline` looks for `_G.MiniIcons` on its
  very first draw (`show_icons = true`, see `minitabline.lua` below), and loading `mini.icons`
  any later would leave that first frame without a provider and shift the tabline's layout once
  it arrived (plan.md phase 14). `setup()` is passed only `style = "glyph"` (Nerd Font icons
  over plain-text ones); it renders correctly only with a Nerd Font installed in the terminal
  (this machine uses Ghostty with HackGen Console NF, configured outside this repo in
  `config.ghostty`). `mini.pick` and `mini.files` already looked for `_G.MiniIcons` themselves
  before this file existed, so both switched from a single generic icon to per-file-type glyphs
  with no change to either plugin's own config.
- `lua/plugins/minipick.lua`: config for `echasnovski/mini.pick` (fuzzy finder). Not loaded
  at startup; `<leader>ff` (find files), `<leader>fg` (live grep), `<leader>fb` (switch
  between open files), or the first call to `vim.ui.select` (e.g. picking an LSP code action)
  each run `vim.cmd.packadd()` and `setup()` on first trigger. `<leader>ff` and `<leader>fg`
  set `RIPGREP_CONFIG_PATH` to `ripgreprc` only for the duration of the call, so `rg` also
  searches hidden files/dirs (except `.git`) there, without affecting `rg` anywhere else.
  The prompt is not Insert mode — mini.pick reads keys itself and consults only its own
  `mappings` table, so the Emacs-style keys from `lua/config/keybind.lua` never reach it.
  Four of them are put back there instead: `<C-b>`/`<C-f>` move the caret, `<C-h>`/`<C-d>`
  delete the character to its left/right. Each action holds exactly one key, so those four
  take the places of `<Left>`, `<Right>`, `<BS>` and `<Del>`, which no longer work in the
  prompt. Scrolling moves to the Alt version of the same letter (`<M-f>`/`<M-b>` vertically,
  `<M-h>`/`<M-l>` horizontally); it still matters with the preview open (`<Tab>`).
- `lua/plugins/minitabline.lua`: config for `echasnovski/mini.tabline` (draws the open
  buffers as a row of tabs along the top line of the screen). What is listed there are
  buffers, not Vim tab pages, which this config does not use. Loaded at startup with
  `packadd!`, for the same reason as `gruvbox.lua` and unlike the four lazy-loaded plugins:
  the tabline is part of the first frame drawn, and there is no "first use" a key could stand
  in for, since the line is simply always visible. `setup()` forces `showtabline = 2`;
  `showtabline = 1` counts tab pages rather than buffers, so it would keep the line hidden
  permanently here. `show_icons` is `true`: `lua/plugins/miniicons.lua` (above) loads
  `mini.icons` at startup before this file's `require()` runs, so `_G.MiniIcons` already
  exists by the tabline's first draw. `format` is left at its default and, because a
  Lua table literal cannot distinguish `format = nil` from an omitted key, is not written out.
  Switching buffers is done with the built-in `[b`/`]b`, with `<leader>fb`, or by clicking a
  tab with the mouse; no mapping is added for it. Terminals get no tab, because
  `lua/config/autocmd.lua` clears their `'buflisted'`. Same-named files in different
  directories are disambiguated by prefixing the parent directory (`nvim/init.lua` against
  `plugins/init.lua`), and when the tabs do not all fit, `«` and `»` mark the cut ends —
  those two come from `'listchars'` in `lua/config/general.lua`, which is where mini.tabline
  reads them from. The five `MiniTabline*` highlight overrides live in `lua/plugins/gruvbox.lua`:
  by default the current buffer and a buffer merely shown in another split are drawn
  identically, and an unsaved tab borrows the status line's pale bar, which sits one row below
  it under `laststatus = 3`. The overrides give the current tab a solid green block, leave
  green text for a visible-but-not-current one, and move the unsaved variants to yellow.
- `lua/util/lazy.lua`: shared loader for lazy-loaded plugins (`claudecode.lua`, `miniclue.lua`,
  `minifiles.lua`, `minipick.lua`). Exposes one function, `M.require(pack_name, module_name,
  setup)`, that runs `vim.cmd.packadd(pack_name)` and `setup(require(module_name))` exactly
  once — while `package.loaded[module_name]` is already filled, neither runs again — then
  returns `require(module_name)`.
- `nvim-pack-lock.json`: generated by `vim.pack` once a plugin is installed. Records the
  exact revision in use so another machine can reproduce it.
- `ripgreprc`: `rg` (ripgrep) config (`--hidden` and `--glob=!.git`). Only takes effect
  while `<leader>ff`/`<leader>fg` run, via `RIPGREP_CONFIG_PATH` set for that call in
  `lua/plugins/minipick.lua`; `rg` run from a shell, or by anything else, is unaffected.

## Language servers

Each server is declared as a [mise](https://mise.jdx.dev/) tool in
`~/workspace/repos/dotfiles/.config/mise/config.toml` (`~/.config/mise` is a symlink to
that directory). On another machine, `mise install` fetches every server listed here.

| Language   | `vim.lsp.enable()` name | mise tool               |
| ---------- | ----------------------- | ------------------------ |
| Rust       | `rust_analyzer`          | `rust-analyzer`           |
| Python     | `pyright`, `ruff`        | `npm:pyright`, `ruff`     |
| Lua        | `lua_ls`                 | `lua-language-server`     |
| Shell      | `bashls`                 | `npm:bash-language-server` |
| Markdown   | `marksman`               | `marksman`                 |
| TypeScript | `ts_ls`                  | `npm:typescript-language-server` |

Two prerequisites are not covered by `mise install` alone:

- `ts_ls` does not bundle a TypeScript compiler; it requires the project being edited to
  have its own `typescript` `devDependency` (a plain `.ts` file with no project is not
  supported).
- mise's own activation must be the last step of shell startup, after every setting that
  modifies `PATH`, or a stale binary (e.g. a rustup proxy) can shadow the mise-managed one.
  See `~/workspace/repos/dotfiles/.config/zsh/README.md` for the load-order convention.
