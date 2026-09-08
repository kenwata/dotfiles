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
    │   └── minipick.lua    # echasnovski/mini.pick config, lazy-loaded on first <leader>ff/fg/fb or vim.ui.select
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
  `CursorMovedI`).
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
- `lua/plugins/minipick.lua`: config for `echasnovski/mini.pick` (fuzzy finder). Not loaded
  at startup; `<leader>ff` (find files), `<leader>fg` (live grep), `<leader>fb` (switch
  between open files), or the first call to `vim.ui.select` (e.g. picking an LSP code action)
  each run `vim.cmd.packadd()` and `setup()` on first trigger. `<leader>ff` and `<leader>fg`
  set `RIPGREP_CONFIG_PATH` to `ripgreprc` only for the duration of the call, so `rg` also
  searches hidden files/dirs (except `.git`) there, without affecting `rg` anywhere else.
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
