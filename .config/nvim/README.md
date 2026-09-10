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
    ├── common/
    │   └── lazy.lua       # Shared packadd-then-setup-once loader for lazy-loaded plugins
    ├── config/
    │   ├── general.lua     # Editor options (UI, window, indent, search, editing, timing, clipboard, etc.)
    │   ├── keybind.lua      # Key mappings
    │   └── autocmd.lua      # Autocommands
    └── plugins/
        ├── init.lua        # vim.pack.add() (single call, deferred load), then requires below
        ├── claudecode.lua  # coder/claudecode.nvim config, lazy-loaded on first <leader>a* key
        ├── gruvbox.lua     # ellisonleao/gruvbox.nvim config, loaded at startup (colorscheme)
        ├── lspconfig.lua   # nvim-lspconfig registration and vim.lsp.enable() for 7 servers
        ├── lualine.lua     # nvim-lualine/lualine.nvim config, loaded at startup (status line)
        ├── markview.lua    # OXY2DEV/markview.nvim config, lazy-loaded on the first markdown FileType
        ├── miniclue.lua    # echasnovski/mini.clue config, lazy-loaded on first trigger key
        ├── minifiles.lua   # echasnovski/mini.files config, lazy-loaded on first <leader>e press
        ├── miniicons.lua   # echasnovski/mini.icons config, loaded at startup (icon provider)
        ├── minipick.lua    # echasnovski/mini.pick config, lazy-loaded on first <leader>ff/fg/fb or vim.ui.select
        ├── minitabline.lua # echasnovski/mini.tabline config, loaded at startup (tabline)
        ├── toggleterm.lua  # akinsho/toggleterm.nvim config, lazy-loaded on first <C-\> press
        └── treesitter.lua  # nvim-treesitter/nvim-treesitter config, lazy-loaded on two FileType autocmds
```

- `init.lua`: calls `vim.loader.enable()` first (the bytecode cache only covers modules
  `require`d after it), sets `vim.g.mapleader`, then `require`s each module in `lua/config/`,
  then `require("plugins")`.
- `lua/config/general.lua`: `vim.o`/`vim.opt` settings, grouped by section comment.
- `lua/config/keybind.lua`: `vim.keymap.set` mappings, each with an English `desc`. Covers
  leaving Insert/Terminal mode (`jj`), Emacs-style cursor movement and deletion in Insert mode
  and in command-line mode (`:`/`/`/`?` input and `input()` prompts -- mini.pick's own prompt is
  not command-line mode and is unaffected), the completion menu, search (recentring on `n`/`N`,
  `;` for the command line), display-line and window movement, keeping the Visual selection
  across an indent, and the inlay-hint toggle. The command-line mappings cost three built-in
  keys: `c_CTRL-A` (insert every wildmenu match), `c_CTRL-K` (start a digraph), and `c_CTRL-F`
  (open the command-line window -- unreachable even though `'cedit'` still reads `^F`, because
  mapping resolution runs first); Normal-mode `q:`/`q/` still open that window.
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
- `lua/plugins/lualine.lua`: config for `nvim-lualine/lualine.nvim` (status line), pinned to
  commit `221ce6b2d999187044529f49da6554a92f740a96` in `lua/plugins/init.lua` (no release tag
  exists for this plugin). Loaded at startup with `packadd!`, for the same reason as
  `gruvbox.lua` and `minitabline.lua`: the status line is part of the first frame drawn, and
  there is no "first use" a key could stand in for. Must load after `gruvbox.lua`: its custom
  theme calls `require("gruvbox").palette`, which errors "module not found" until
  `gruvbox.lua`'s own `packadd` has put `gruvbox.nvim` on runtimepath. The custom theme reuses
  `gruvbox_dark`'s own `b`/`c` colors and inactive state verbatim, replacing only each mode's
  `a` section background, since `mini.tabline`'s current-tab highlight is already a solid
  bright-green fill and a green mode block would read as the same colored chunk repeated one
  line below it. The configuration picked on real hardware (see
  `docs/design/lualine-startup-statusline.md` in the planning repository): the
  "information-heavy" section layout (`branch`, `diff`, `filename`,
  `lsp_status`, `diagnostics`, `searchcount`, `selectioncount`, `encoding`, `fileformat`,
  `filetype`, `progress`, `location`), powerline separators (U+E0B0/U+E0B2, filled triangles),
  icons enabled (supplied through the `nvim-web-devicons` bridge `miniicons.lua` registers,
  see below), relative path display, and `extensions` enabled for `toggleterm` and
  `quickfix` (their own buffers read oddly under the sections above -- a raw `term://` name
  where `filename` expects a file, an empty `diagnostics` count for a list that has none).
  Every option lualine.nvim accepts is written out, including ones left at their default, same
  convention as `gruvbox.lua`. Roles are split with `mini.tabline` (`minitabline.lua` below):
  that plugin owns the tab row, this one owns the status line beneath it, and neither draws
  what the other is responsible for.
- `lua/plugins/markview.lua`: config for `OXY2DEV/markview.nvim` (decorates markdown in the
  buffer being edited -- headings, code blocks, tables, links -- without changing the file).
  Not loaded at startup; a `FileType markdown` autocmd loads it through `lua/common/lazy.lua`
  the first time a markdown buffer appears, since opening one is itself the moment decoration
  starts to matter. `<Leader>im` toggles the decoration for the current buffer, and loads the
  plugin first so the key also works before any markdown file has been opened. Only three
  options are set: `preview.filetypes` narrowed to `markdown` alone, `preview.icon_provider`
  left at markview's own `internal`, and `markdown_inline.tags` disabled. The last two are
  not defaults chosen by inertia:
  - `icon_provider` was tried as `"mini"` (matching the icon set `mini.pick` / `mini.files` /
    `mini.tabline` use) but a fenced code block with no language tag makes markview call
    `mini.icons.get("filetype", nil)`, which throws; markview swallows the error and leaves
    that whole block undecorated. `internal` falls back to its own "unknown language" style
    instead of throwing.
  - `markdown_inline.tags` off, because ids written as `#16` / `#16-1` in the planning
    documents this config edits are read as tag syntax. Decorating a tag conceals the `#` and
    pads what remains with a space on each side, making the cell one column wider than its
    source text, which knocks every column to its right out of alignment inside a table.
  Hybrid mode (`preview.hybrid_modes`, which would strip the decoration from the cursor's own
  line) is left off, and `wrap` stays on in `lua/config/general.lua`. That last one has a
  cost: markview refuses to draw a table at all -- not even its outer border -- once the
  table's columns add up to 90% of the window width or more, which is where the wider tables
  in those planning documents land. The `listchars` dots and eol arrows are hidden while the
  decoration is on screen and come back in insert and replace mode, through the `MarkviewAttach`
  / `MarkviewEnable` / `MarkviewDisable` / `MarkviewDetach` events plus a `ModeChanged` and a
  `BufWinEnter` autocmd. The `BufWinEnter` restore only touches a normal file buffer
  (`buftype == ""`); a terminal, quickfix, or `nofile` buffer already has something else
  deciding `'list'` (Neovim itself for a terminal), and writing the global value on top of that
  used to make listchars reappear the second time a closed terminal was reopened. Parsers for
  `html` and `latex` are not installed, so markdown written
  in those (inline HTML, math) stays undecorated. `yaml` and `toml` are installed (see
  `lua/plugins/treesitter.lua` below); Neovim's own `$VIMRUNTIME/queries/markdown/injections.scm`
  routes YAML-delimited front matter (`---`) through `yaml` and TOML-delimited front matter
  (`+++`) through `toml`, but markview only ships a renderer for the former
  (`lua/markview/renderers/yaml.lua`) -- TOML front matter still renders as plain `toml` syntax
  highlighting, with none of markview's own field decoration.
- `lua/plugins/miniclue.lua`: config for `echasnovski/mini.clue` (shows the next available
  keys and their descriptions in a floating window after a prefix key is held). Not loaded
  at startup; 19 key/mode combinations (`<Leader>`, `g`, `s`, `z`, `[`/`]`, `<C-w>`, `"`, `'`,
  `` ` ``, `<C-x>`) each carry a global `<nowait>` stub that deletes every stub, loads
  `mini.clue` through `lua/common/lazy.lua`, then replays the key so mini.clue's own
  (buffer-local) trigger takes over from the second press onward. The clue window appears
  after a 300ms delay.
- `lua/plugins/minifiles.lua`: config for `echasnovski/mini.files` (file explorer: browse,
  create, rename, move, and delete files by editing a buffer). Not loaded at startup;
  `<Leader>e` toggles it open/closed through `lua/common/lazy.lua`, opening at the current
  working directory. Also replaces netrw as the explorer that appears when a directory is
  opened (`nvim <dir>` or `:e <dir>`): `vim.g.loaded_netrw`/`loaded_netrwPlugin` disable netrw
  at startup, and a `BufEnter` stub opens `mini.files` for the first directory buffer before
  the plugin itself is loaded (its own `BufEnter`, registered by `setup()`, handles every one
  after that). Deletion is permanent (`options.permanent_delete = true`, no trash/recycle bin).
  `<C-q>` closes the explorer as well as the built-in `q`, bound buffer-locally on
  `User MiniFilesBufferCreate` since `mappings` only accepts one key per action.
  `windows.width_preview` is widened from the default 25 to 80 columns, picked on the real
  Ghostty terminal; `width_focus`/`width_nofocus` are left at their defaults.
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
  with no change to either plugin's own config. `lualine.nvim` (`lualine.lua` above) looks only
  for `nvim-web-devicons`, never `mini.icons` directly, so this file's `setup()` call is
  followed by `require("mini.icons").mock_nvim_web_devicons()`, registering a fake
  `nvim-web-devicons` module backed by `mini.icons`. That call cannot be undone once made in a
  session, so it runs unconditionally rather than being gated on anything, and it lives here
  rather than in `lualine.lua` so that "who supplies icons" stays readable from a single file.
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
  `<C-q>` closes the picker as well as the built-in `<Esc>`, added as a custom `stop_alt`
  action that sends the raw `<C-c>` byte back through `nvim_feedkeys` rather than returning
  `true` directly, so that `vim.ui.select` sees a cancelled selection (`on_choice(nil)`) the
  same way `<Esc>` does.
- `lua/plugins/minitabline.lua`: config for `echasnovski/mini.tabline` (draws the open
  buffers as a row of tabs along the top line of the screen). What is listed there are
  buffers, not Vim tab pages, which this config does not use. Loaded at startup with
  `packadd!`, for the same reason as `gruvbox.lua` and unlike the seven lazy-loaded plugins:
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
- `lua/plugins/toggleterm.lua`: config for `akinsho/toggleterm.nvim` (opens and hides a shell
  terminal with one key). Not loaded at startup; `<C-\>` in Normal mode runs
  `vim.cmd.packadd()` and `setup()` on first press through `lua/common/lazy.lua`. That mapping
  reads `v:count` itself so that `2<C-\>` reaches the second terminal on the very first press
  as well.
  **Only one terminal is ever on screen.** toggleterm gives each terminal its own split, so
  opening a second one would leave both visible side by side; every entry point here closes the
  others first, turning the bottom of the screen into a single 12-row slot whose occupant the
  mappings swap. `open_mapping` and `terminal_mappings` are therefore left unset -- they would
  bind `<Cmd>ToggleTerm<CR>`, which opens alongside whatever is already up -- and each key is
  bound by hand instead. In Normal mode `<C-\>` shows the terminal matching the count typed
  before it, hides the terminal when one is up, and otherwise reopens the one used last. Inside a
  terminal, `<C-\>` and `<C-q>` hide it (matching how the Claude Code terminal closes), and
  `<M-1>` through `<M-9>` switch to that terminal, starting it when the number is unused. Those
  are buffer-local: Terminal mode passes every unbound key to the shell, so without them there is
  no way from one terminal into another -- even `<C-w>k` reaches zsh -- and binding them globally
  would collide with the `<C-q>` that `claudecode.lua` binds for its own terminal. The cost is
  that zsh loses `<C-q>`, `<C-\>` and its digit arguments inside these terminals.
  The winbar above the slot lists every terminal as `1 zsh 2 zsh ...`, marks the visible one, and
  is clickable; it stands in for the tabline, which never lists terminals because
  `lua/config/autocmd.lua` clears their `'buflisted'`. `persist_mode` is off, against its default:
  a terminal is always left in Normal mode when `<M-n>` hops away from it, and restoring that on
  the way back would strand the cursor outside Terminal mode where `<M-n>` no longer fires.
  Switching terminals reuses the window rather than closing and reopening it, which would empty
  the slot for an instant and flicker. `close_on_exit` is off for the same reason: ending a shell
  with `exit` or `<C-d>` would otherwise take the whole slot with it and drop the cursor back in
  the editor even with other terminals still running, so `on_exit` swaps the neighbouring terminal
  (the next one by number, or the previous one) into the standing window instead. The window is
  only given up once the last terminal is gone. Terminal mode is restored 20ms later rather than
  on the next tick, because Neovim leaves Terminal mode itself as the last step of tearing the job
  down -- anything earlier is undone by that.
  Claude Code's terminal is untouched by all of this -- it keeps its own vertical split on the
  right (`claudecode.lua`).
- `lua/plugins/treesitter.lua`: config for `nvim-treesitter/nvim-treesitter`. Pinned to the
  `main` branch, at commit `5cb0114e6242625db56dd6440e945ed1ece10bc7` in `lua/plugins/init.lua`
  (the branch is a parser install/update/remove tool and a filetype-to-parser-name mapping,
  not a syntax highlighter itself -- highlighting is Neovim core's own
  `vim.treesitter.start()`, called here once a parser is confirmed installed). Not loaded at
  startup; two `FileType` autocmds trigger it. The first covers ten filetypes (`rust`,
  `python`, `typescript`, `typescriptreact`, `sh`, `bash`, `json`, `jsonc`, `toml`, `yaml`),
  calls `vim.treesitter.start()`, and sets `foldmethod`/`foldexpr` to
  `v:lua.vim.treesitter.foldexpr()` for structural code folding (`foldlevelstart` in
  `lua/config/general.lua` keeps a freshly opened buffer unfolded). The second covers
  `markdown` alone and only needs the filetype-to-parser mapping for fenced code blocks
  (```sh, ```ts) -- markdown's own highlighting already comes from Neovim's
  `$VIMRUNTIME/ftplugin/markdown.lua`. Eight parsers are installed: `rust`, `python`,
  `typescript`, `tsx`, `bash`, `json`, `toml`, `yaml` (three filetypes map to a different
  parser name -- `sh` -> `bash`, `typescriptreact` -> `tsx`, `jsonc` -> `json` -- resolved
  through `vim.treesitter.language.get_lang()`). A buffer whose parser is missing runs an
  async `install()` instead of blocking and stays unhighlighted until that filetype is next
  opened. Installing or updating a parser shells out to the `tree-sitter` CLI, which comes
  from `mise` (declared in `~/workspace/repos/dotfiles/.config/mise/config.toml`, distinct
  from the language servers in the table below) and is only on `PATH` once `mise activate`
  has run for the shell that launched Neovim. Bumping the pinned commit hash in
  `lua/plugins/init.lua` updates the plugin's own Lua code and query files, but not the
  eight already-compiled parsers; keeping those current after such a bump needs a manual
  `:TSUpdate`.
- `lua/common/lazy.lua`: shared loader for lazy-loaded plugins (`claudecode.lua`, `markview.lua`,
  `miniclue.lua`, `minifiles.lua`, `minipick.lua`, `toggleterm.lua`, `treesitter.lua`). Exposes
  one function, `M.require(pack_name, module_name, setup)`, that runs
  `vim.cmd.packadd(pack_name)` and `setup(require(module_name))` exactly once — while
  `package.loaded[module_name]` is already filled, neither runs again — then returns
  `require(module_name)`.
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
