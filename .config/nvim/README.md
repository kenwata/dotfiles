# Neovim Configuration

`~/.config/nvim` is a symlink to this directory
(`~/workspace/repos/dotfiles/.config/nvim`). Neovim reads the config through that
symlink.

## Layout

```
.config/nvim/
├── README.md              # This file
├── init.lua                # Loader only: sets the leader key, requires the modules below
├── lazy-lock.json          # lazy.nvim lockfile (installed plugin revisions); never edit by hand
├── ripgreprc               # rg config, applied only while <leader>ff/<leader>fg run (not the shell's rg)
└── lua/
    ├── config/
    │   ├── general.lua     # Editor options (UI, window, indent, search, editing, timing, clipboard, etc.)
    │   ├── keybind.lua      # Key mappings
    │   ├── autocmd.lua      # Autocommands
    │   └── lazy.lua         # Bootstraps lazy.nvim, then hands lua/plugins/ to it
    └── plugins/
        ├── autopairs.lua    # windwp/nvim-autopairs config, lazy-loaded on first InsertEnter
        ├── claudecode.lua   # coder/claudecode.nvim config, lazy-loaded on first <leader>a* key
        ├── diffview.lua     # dlyongemallo/diffview-plus.nvim config, lazy-loaded on first :Diffview* command or <leader>gd/gh key
        ├── gitmessenger.lua # rhysd/git-messenger.vim config, lazy-loaded on first :GitMessenger command or <leader>gm key
        ├── gitsigns.lua     # lewis6991/gitsigns.nvim config, lazy-loaded on first buffer read
        ├── gruvbox.lua      # ellisonleao/gruvbox.nvim config, loaded at startup (colorscheme)
        ├── lazy.lua         # lazy.nvim's own spec entry (pins its version)
        ├── lspconfig.lua    # nvim-lspconfig registration and vim.lsp.enable() for 7 servers
        ├── lualine.lua      # nvim-lualine/lualine.nvim config, loaded at startup (status line)
        ├── markview.lua     # OXY2DEV/markview.nvim config, lazy-loaded on the first markdown FileType
        ├── miniclue.lua     # echasnovski/mini.clue config, lazy-loaded on first trigger key
        ├── minifiles.lua    # echasnovski/mini.files config, lazy-loaded on first <leader>e press
        ├── miniicons.lua    # echasnovski/mini.icons config, loaded at startup (icon provider)
        ├── minipick.lua     # echasnovski/mini.pick config, lazy-loaded on first <leader>ff/fg/fb or vim.ui.select
        ├── minitabline.lua  # echasnovski/mini.tabline config, loaded at startup (tabline)
        ├── snacks.lua       # folke/snacks.nvim config, loaded at startup (dashboard)
        ├── surround.lua     # kylechui/nvim-surround config, lazy-loaded on first surround key
        ├── textobjects.lua  # nvim-treesitter/nvim-treesitter-textobjects config, lazy-loaded on first select/move/swap key
        ├── toggleterm.lua   # akinsho/toggleterm.nvim config, lazy-loaded on first <C-\> press
        ├── treesitter.lua   # nvim-treesitter/nvim-treesitter config, lazy-loaded on two FileType autocmds
        └── vimatrix.lua     # wolfwfr/vimatrix.nvim config, lazy-loaded on VeryLazy / first dashboard
```

- `init.lua`: calls `vim.loader.enable()` first (the bytecode cache only covers modules
  `require`d after it), sets `vim.g.mapleader`, then `require`s each module in `lua/config/`,
  ending with `config.lazy` (which bootstraps lazy.nvim and hands it every file under
  `lua/plugins/`).
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
- `lua/config/lazy.lua`: bootstraps lazy.nvim on first run (clones it to
  `stdpath("data")/lazy/lazy.nvim` if that path does not yet exist, then prepends it to
  `'runtimepath'`), then calls `require("lazy").setup()` with `spec = { { import = "plugins" } }`
  so every file under `lua/plugins/` is read as a spec. Four options are decided here and
  everything else keeps lazy.nvim's own default: `rocks.enabled = false` (none of the plugins
  below needs a luarocks package), `install.colorscheme = { "gruvbox" }` (the very first install
  screen already uses this config's colorscheme instead of the default habamax),
  `change_detection.enabled = false` (editing dotfiles from outside this Neovim session, e.g.
  Claude Code, would otherwise pop a reload notification and re-read specs mid-edit; a config
  change applies on the next `:restart` instead), and `checker.enabled` stays at its own default
  (`false`, so plugin updates stay manual via `:Lazy update`, never auto-checked).
- `lua/plugins/lazy.lua`: pins lazy.nvim's own version (`version = "11"`). lazy.nvim adds
  itself to the plugin spec implicitly with no version pinned; this file pins it explicitly,
  per `.claude/rules/lua.md`'s "pin a version" rule.
- `lua/plugins/autopairs.lua`: config for `windwp/nvim-autopairs` (auto-closes brackets and
  quotes as they are typed, and offers a fast-wrap operation for closing an existing word).
  Not loaded at startup; the spec's `event = "InsertEnter"` loads it the first time Insert mode
  is entered, since none of its entry keys (`(`, `[`, `{`, `"`, `'`, `` ` ``, `<CR>`, `<BS>`,
  `<C-h>`, `<M-e>`) means anything outside Insert mode. Three options are set: `map_c_h = true`
  (deleting both characters of a pair with `<C-h>`, on top of the plain single-character
  deletion it already did), `fast_wrap` (mapped to `<M-e>`; its marker colors were chosen on the
  real Ghostty terminal -- `highlight = "IncSearch"`, `highlight_grey = "NonText"`,
  `use_virt_lines = true`), and `disable_filetype` (the plugin's own defaults plus `minifiles`,
  since `mini.files` rewrites the buffer's text as filenames for renaming and a single `(` there
  would otherwise become `()`). `map_cr` (default true) and `map_c_w` (default false) are left at
  their defaults; the file comments explain why each is not disabled/enabled. `config()` also
  registers `nvim-autopairs.rules.endwise-lua`, which inserts the matching `end` when Enter is
  pressed at the end of a line ending in `then`, `do`, or `function name(...)`. It decides this
  from the syntax tree under the cursor, so it depends on the surrounding code: inside an
  enclosing block (e.g. typing `if x then` within a function body) the `end` is inserted, but in
  an otherwise empty buffer, or at top level with other statements following, Neovim's bundled
  Lua parser reads the unclosed statement as `ERROR` and no `end` is added (observed with the
  pinned commit).
- `lua/plugins/claudecode.lua`: config for `coder/claudecode.nvim`. Not loaded at startup;
  the spec's `keys` table declares one entry per `<leader>a*` key (toggle, focus, resume,
  continue, model, add buffer, send selection, accept/deny diff), so any one of them loads the
  plugin and runs `config()` on first press -- no single key has to come first. Each entry calls
  `vim.cmd(<command>)` rather than a `<cmd>` mapping string, since the command does not exist
  until `config()` has registered it, and lazy.nvim runs `config()` before invoking the key's own
  function on that first press. `init()` binds `<C-q>` in terminal mode globally to close the
  Claude Code terminal; this one is not an entry point, so it only checks `package.loaded`
  rather than triggering a load of its own.
- `lua/plugins/diffview.lua`: config for `dlyongemallo/diffview-plus.nvim` (an actively
  maintained fork of `sindrets/diffview.nvim`, picked because the original has had no commits
  since 2024-06-13; shows the full diff of every changed file and a file's commit history),
  pinned to `version = "0.37"`. Not loaded at startup; the spec's `cmd` table lists the 11
  `:Diffview*` commands `plugin/diffview.lua` defines, and `keys` adds `<leader>gd`
  (`:DiffviewToggle`, opens the all-files diff view or closes it if already open) and
  `<leader>gh` (`:DiffviewFileHistory %`, the current file's history), each with an English
  `desc`. Keys inside the diff view itself are left at the plugin's own defaults.
- `lua/plugins/gitmessenger.lua`: config for `rhysd/git-messenger.vim` (pops up the commit
  message for the line under the cursor), pinned to commit
  `fd124457378a295a5d1036af4954b35d6b807385` (no release tag exists for this plugin). Not
  loaded at startup; the spec's `cmd` table lists `GitMessenger`/`GitMessengerClose`, and `keys`
  adds `<leader>gm` with an English `desc`. `init()` sets
  `vim.g.git_messenger_no_default_mappings = true` before the plugin's own `plugin/` script can
  read it, since its built-in `<leader>gm` mapping carries no `desc`.
- `lua/plugins/gitsigns.lua`: config for `lewis6991/gitsigns.nvim` (per-line change signs in the
  sign column, plus hunk-level stage/reset/preview/navigate operations), pinned to
  `version = "2"`. Not loaded at startup; `event = { "BufReadPost", "BufNewFile" }` loads it the
  first time a buffer is read or created -- `signcolumn = "yes"` already reserves the column, so
  a sign appearing a moment later does not shift anything on screen. `opts.on_attach` creates
  buffer-local keys with an English `desc` each: `]c`/`[c` navigate hunks (falling back to
  Neovim's builtin `]c`/`[c` inside a diff-mode window), `<leader>gs`/`<leader>gr` stage/reset in
  both Normal and Visual mode, `<leader>gp` previews a hunk, `<leader>gb` shows file blame, and
  `ih` selects a hunk as a text object. `on_attach` also re-derives `mini.clue`'s buffer-local
  triggers when it is already loaded (`miniclue.lua` below), since gitsigns attaches
  asynchronously, after `mini.clue`'s own `BufWinEnter`/`LspAttach` hooks have already run. Sign
  symbols (`signs`/`signs_staged`) and `numhl` were compared against alternatives on the real
  terminal and kept at v2.1.0's own defaults (see `docs/design/git-plugins-lazy-integration.md`
  in the planning repository, section「見た目」); `opts` spells each one out explicitly rather
  than leaving it unset. Staged signs use the same colors as unstaged ones: `gruvbox.lua` overrides
  the 5 `GitSignsStaged*` groups, which gitsigns would otherwise derive as a dimmed copy of the
  unstaged colors, so the sign column does not show whether a hunk is staged.
- `lua/plugins/gruvbox.lua`: config for `ellisonleao/gruvbox.nvim` (colorscheme). Unlike
  `claudecode.lua` and `minipick.lua`, this one is loaded at startup (`lazy = false`), because a
  colorscheme affects the first frame drawn and deferring it would leave the default colors on
  screen until something triggered the load. `priority = 1000` places it ahead of the other
  `lazy = false` plugins at startup, since `lualine.lua`'s theme calls `require("gruvbox").palette`
  and needs gruvbox's own `config()` to have already run. Sets `background` to `dark`, passes
  every option the plugin accepts to `setup()` (each one chosen by looking at the result on
  screen), then applies it with `:colorscheme`. `overrides` also sets nine `SnacksDashboard*`
  groups (`Header`/`Title`/`File`/`Special` in `bright_blue`, `Key`/`Icon`/`Footer` in
  `neutral_blue`, `Desc` in `light1`, `Dir` in `light4`) -- snacks defines these as `default = true`
  links on `UIEnter`, after this colorscheme has already loaded, so the overrides win (see
  `snacks.lua` below).
- `lua/plugins/lspconfig.lua`: loads `nvim-lspconfig` at startup (`lazy = false`; a pure
  configuration-data repository, not a runtime plugin, so this costs nothing measurable),
  overrides `lua_ls` to recognize Neovim's `vim` global and runtime files, and enables the
  7 language servers listed below with `vim.lsp.enable()`. The `lua_ls` override applies to
  every Lua workspace except one that carries its own `.luarc.json` / `.luarc.jsonc`, which
  is the opt-out; the header comment in that file explains why the condition is that broad.
  Every other setting each server receives comes from nvim-lspconfig's own `lsp/*.lua` and is
  deliberately left untouched.
- `lua/plugins/lualine.lua`: config for `nvim-lualine/lualine.nvim` (status line), pinned to
  commit `221ce6b2d999187044529f49da6554a92f740a96` (no release tag exists for this plugin).
  Loaded at startup (`lazy = false`), for the same reason as `gruvbox.lua` and
  `minitabline.lua`: the status line is part of the first frame drawn, and there is no "first
  use" a key could stand in for. `dependencies = { "gruvbox.nvim", "mini.icons" }` makes
  lazy.nvim run both of those plugins' specs before this one's `config()`: its custom theme
  calls `require("gruvbox").palette`, which errors "module not found" until gruvbox's own
  `config()` has put `gruvbox.nvim` on runtimepath, and its filetype component looks for the
  fake `nvim-web-devicons` module `mini.icons` registers (`miniicons.lua`). The custom theme
  reuses `gruvbox_dark`'s own `b`/`c` colors and inactive state verbatim, replacing only each
  mode's `a` section background, since `mini.tabline`'s current-tab highlight is already a solid
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
  Not loaded at startup; the spec's `ft = "markdown"` loads it the first time a markdown buffer
  appears, since opening one is itself the moment decoration starts to matter. The spec's `keys`
  table also declares `<Leader>im`, which toggles the decoration for the current buffer and
  loads the plugin first so the key also works before any markdown file has been opened. Only
  three options are set: `preview.filetypes` narrowed to `markdown` alone, `preview.icon_provider`
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
  `BufWinEnter` autocmd, all set up in `init()`. The `BufWinEnter` restore only touches a normal
  file buffer (`buftype == ""`); a terminal, quickfix, or `nofile` buffer already has something
  else deciding `'list'` (Neovim itself for a terminal), and writing the global value on top of
  that used to make listchars reappear the second time a closed terminal was reopened. Parsers
  for `html` and `latex` are not installed, so markdown written
  in those (inline HTML, math) stays undecorated. `yaml` and `toml` are installed (see
  `lua/plugins/treesitter.lua` below); Neovim's own `$VIMRUNTIME/queries/markdown/injections.scm`
  routes YAML-delimited front matter (`---`) through `yaml` and TOML-delimited front matter
  (`+++`) through `toml`, but markview only ships a renderer for the former
  (`lua/markview/renderers/yaml.lua`) -- TOML front matter still renders as plain `toml` syntax
  highlighting, with none of markview's own field decoration.
- `lua/plugins/miniclue.lua`: config for `echasnovski/mini.clue` (shows the next available
  keys and their descriptions in a floating window after a prefix key is held). Not loaded
  at startup; `lazy = true` with no trigger declared in the spec, since the entry points here
  are not real commands but 19 manual stubs `init()` sets up (one per key/mode combination:
  `<Leader>`, `g`, `s`, `z`, `[`/`]`, `<C-w>`, `"`, `'`, `` ` ``, `<C-x>`). Each stub deletes
  every stub, calls `require("lazy").load({ plugins = { "mini.clue" } })`, then replays the key
  that triggered it (`nvim_feedkeys`), so mini.clue's own (buffer-local) trigger takes over from
  the second press onward. `config()` sets up the trigger list, named groups for prefixes whose
  own `desc` does not say what the group is (mini.clue's `gen_clues` cover the builtin groups:
  `g`, `square_brackets`, `marks`, `registers`, `windows`, `z`, `builtin_completion`; `s` is not
  listed since `keybind.lua`'s `desc` on each `ssvhjk` mapping already says what it does), and a
  300ms window delay with `width = "auto"` (the default fixed 30-column width truncates the
  longest `square_brackets` descriptions to the same prefix and makes them indistinguishable).
- `lua/plugins/minifiles.lua`: config for `echasnovski/mini.files` (file explorer: browse, create,
  rename, move, and delete files by editing a buffer). Not loaded at startup; the spec's `keys`
  table declares `<Leader>e`, which toggles it open/closed. Where it opens depends on the buffer
  on screen. The left-most column is always the "root": the directory `nvim` was started against
  (the first directory among the command-line arguments, captured in `init()`), or the current
  directory when there was none. When the buffer is a file that exists on disk and sits inside the
  root, the explorer lays out one column per directory from the root down to the file's parent
  (`MiniFiles.set_branch()`) and puts the cursor on the file; a file outside the root opens its
  parent directory alone, cursor on the file. Anything else -- an unnamed buffer, a terminal or
  help buffer (non-empty `'buftype'`), a new file not yet written -- opens the root as a single
  column. Either way `open()` is called with `use_latest = false`, so the columns and cursor left
  from the previous visit are not restored. The inside-the-root check matches on the path
  separator, so `/a/project` is not taken to be inside `/a/proj`. Inside the explorer, `<CR>`
  opens the file under the cursor and closes the explorer, or enters the directory under it -- the
  same action as the built-in `L` (`go_in({ close_on_file = true })`). Also replaces netrw as the
  explorer that appears when a directory is opened (`nvim <dir>` or `:e <dir>`): `init()` sets
  `vim.g.loaded_netrw`/`loaded_netrwPlugin` to disable netrw at startup, and a `BufEnter` stub
  opens `mini.files` (via `require("lazy").load(...)`) for the first directory buffer before the
  plugin itself is loaded (its own `BufEnter`, registered by `config()`, handles every one after
  that). Deletion is permanent (`options.permanent_delete = true`, no trash/recycle bin). `<C-q>`
  closes the explorer as well as the built-in `q`, and `<CR>` works alongside the built-in `L`;
  both are bound buffer-locally on `User MiniFilesBufferCreate` since `mappings` only accepts one
  key per action. `windows.width_preview` is widened from the default 25 to 80 columns, picked on
  the real Ghostty terminal; `width_focus`/`width_nofocus` are left at their defaults.
- `lua/plugins/miniicons.lua`: config for `echasnovski/mini.icons` (icon and highlight-group
  provider; draws nothing itself). Loaded at startup (`lazy = false`), for the same reason as
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
  at startup; the spec's `keys` table declares `<leader>ff` (find files), `<leader>fg` (live
  grep) and `<leader>fb` (switch between open files), and `init()` wraps `vim.ui.select` so the
  first call to it (e.g. picking an LSP code action) also loads the plugin -- these are the
  entry points that can trigger it before the plugin is on disk. `<leader>ff` and `<leader>fg`
  set `RIPGREP_CONFIG_PATH` to `ripgreprc` only for the duration of the call, so `rg` also
  searches hidden files/dirs (except `.git`) there, without affecting `rg` anywhere else.
  The prompt is not Insert mode — mini.pick reads keys itself and consults only its own
  `mappings` table, so the Emacs-style keys from `lua/config/keybind.lua` never reach it.
  Four of them are put back there instead: `<C-b>`/`<C-f>` move the caret, `<C-h>`/`<C-d>`
  delete the character to its left/right. Each action holds exactly one key, so those four
  take the places of `<Left>`, `<Right>`, `<BS>` and `<Del>`, which no longer work in the
  prompt. Scrolling moves to the Alt version of the same letter (`<M-f>`/`<M-b>` vertically,
  `<M-h>`/`<M-l>` horizontally); it still matters with the preview open (`<Tab>`).
  `<leader>ff`, `<leader>fg` and `<leader>fb` show a side preview: a second floating window,
  created by the config rather than by mini.pick (which only swaps list and preview inside one
  window), next to the candidate list and redrawn with the selected candidate whenever the
  selection changes. The layout was picked on the real Ghostty terminal from three named
  patterns (T130): list and preview together take 0.9 of the screen width and 0.8 of its height,
  centered, split 2:3 between list and preview; a `<leader>fg` match is placed at the vertical
  center of the preview (`line_position = "center"`), and the preview's border title shows the
  candidate's path. In these three pickers `<M-f>`/`<M-b>` scroll the side preview instead of
  the list, falling back to scrolling the picker's own window while `<Tab>` has it showing the
  full preview; paging the list a screen at a time is given up there (`<C-n>`/`<C-p>` still
  move one line). All of this is passed per picker, not through `setup()`, so the
  `vim.ui.select` picker keeps no side preview and `<M-f>`/`<M-b>` still scroll its list.
  `<C-q>` closes the picker as well as the built-in `<Esc>`, added as a custom `stop_alt`
  action that sends the raw `<C-c>` byte back through `nvim_feedkeys` rather than returning
  `true` directly, so that `vim.ui.select` sees a cancelled selection (`on_choice(nil)`) the
  same way `<Esc>` does.
- `lua/plugins/minitabline.lua`: config for `echasnovski/mini.tabline` (draws the open
  buffers as a row of tabs along the top line of the screen). What is listed there are
  buffers, not Vim tab pages, which this config does not use. Loaded at startup (`lazy = false`),
  for the same reason as `gruvbox.lua` and unlike the ten lazy-loaded plugins:
  the tabline is part of the first frame drawn, and there is no "first use" a key could stand
  in for, since the line is simply always visible. `dependencies = { "mini.icons" }` makes
  lazy.nvim run `mini.icons`'s own `config()` first, so `_G.MiniIcons` already exists by this
  plugin's first draw. `config()` forces `showtabline = 2`;
  `showtabline = 1` counts tab pages rather than buffers, so it would keep the line hidden
  permanently here. `show_icons` is `true`, relying on that dependency ordering. `format` is
  left at its default and, because a
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
- `lua/plugins/snacks.lua`: config for `folke/snacks.nvim` (`version = "2"`; only its `dashboard`
  module is configured -- see `docs/design/snacks-dashboard-vimatrix-rain.md` in the planning
  repository). Loaded at startup (`lazy = false`), for the same reason as `gruvbox.lua` and
  `minitabline.lua` above: the dashboard it draws is the first frame Neovim shows on a
  no-argument launch. No `priority` is set: the dashboard acts on `UIEnter`, which runs after
  every plugin's `config()` regardless of load order, unlike the `priority = 1000` plugins above
  that hook `BufReadPre` and must win a startup race. No `cond` gate either -- T139 measured a
  `cond = function() return vim.fn.argc(-1) == 0 end` variant (skips loading snacks, and the
  `<leader>d` key below with it, for any session started with a file argument) against this
  always-loaded version. The with-argument startup-time increase over the pre-dashboard baseline
  was smaller for `cond` (+5.0ms, 95% CI [1.4, 7.5]) than for always-loaded (+9.5ms, 95%
  CI [4.7, 15.5]), but the user judged the difference too small to matter and kept always-loaded,
  which also keeps `<leader>d` working in file-argument sessions.
  The dashboard shows six key items -- `f` Find File (`<leader>ff`), `g` Grep (`<leader>fg`),
  `e` Explorer (`<leader>e`), `n` New File, `L` Lazy, `q` Quit (`:qa`) -- routed through the
  existing keymaps rather than snacks' own pickers, so `f`/`g` keep the mini.pick side-preview
  windows (`minipick.lua` above) and `e` keeps the mini.files explorer (`minifiles.lua` above).
  Below the keys, a Recent Files and a Projects section (both `limit = 8`, picked on real
  hardware, T144) list `v:oldfiles`/known project roots scoped to the launch directory
  (`cwd = true`); picking a Projects entry chdirs and replays `<leader>ff`. Header text and the
  one-column layout are snacks' own defaults, kept after comparing alternatives on real hardware
  in T144. `<leader>d` reopens the dashboard in the current window -- non-floating, matching the
  startup path, so `<Esc>` stays free for vimatrix's Rain-stop key below and doesn't collide with
  a floating dashboard's own `<Esc>` binding. It hides the tabline/statusline the same way the
  startup dashboard does and restores them on close or on leaving the window, refuses to run
  inside a terminal buffer or a `winfixbuf` window (notifies instead), and re-binds `q` to close
  only the reopened buffer (`:bd`) rather than quitting Neovim, since snacks' own `q` -> `:qa`
  binding would otherwise win there too. `'cursorline'` stays off (snacks' dashboard style
  default): the current-item band is instead a `CursorLine`-highlighted strip limited to the
  dashboard's text rectangle, drawn by `vimatrix.lua` below because it shares that file's
  rectangle geometry (T144).
- `lua/plugins/surround.lua`: config for `kylechui/nvim-surround`. Not loaded at startup; the
  spec's `keys` table declares 11 expr mappings, one per action (`ys`, `yss`, `yS`, `ySS`, `ds`,
  `cs`, `cS`, `S`, `gS`, `<C-g>s`, `<C-g>S`), each returning the matching `<Plug>` name so
  lazy.nvim loads the plugin and runs `config()` on first press before the expr mapping resolves.
  `init()` sets `vim.g.nvim_surround_no_mappings = true` before the plugin's own `plugin/`
  script can read it, which is what stops its default keymaps from being registered (setting it
  later, inside `config()`, would be too late). `config()` first calls
  `require("lazy").load({ plugins = { "nvim-treesitter-textobjects" } })` so nvim-surround's `f`
  (call surround) can resolve `@call.outer`; without it, `f` silently falls back to a regex
  match instead of erroring (design doc, "依存関係と落とし穴" #1). Then it calls
  `require("nvim-surround").setup()` with no arguments (every option stays at its default).
- `lua/plugins/textobjects.lua`: config for `nvim-treesitter/nvim-treesitter-textobjects`.
  The spec's `keys` table declares 22 select keys (`{ "x", "o" }` mode) for the standard
  select-a-thing pairs, 6 move keys (`{ "n", "x", "o" }` mode) for jumping between
  function/class boundaries, and 2 swap keys (`n` mode) for parameter reordering -- 30 entries
  in total, each loading the plugin and running `config()` on first press. `surround.lua` also
  loads this plugin, through lazy.nvim's own load API rather than through a key here.
  `config()` calls `setup({ select = { lookahead = true } })`.
- `lua/plugins/toggleterm.lua`: config for `akinsho/toggleterm.nvim` (opens and hides a shell
  terminal with one key). Not loaded at startup; the spec's `keys` table declares one entry,
  `<C-\>` in Normal mode, whose function reads `v:count` before calling
  `require("lazy").load({ plugins = { "toggleterm.nvim" } })` (count does not survive the
  require) so `2<C-\>` reaches the second terminal on the very first press as well.
  Terminals open as a floating window (`direction = "float"`) with a rounded border, 0.92 of the
  screen width and 0.82 of its height, centered -- sizes picked on the real Ghostty terminal
  (T135). **Only one terminal is ever on screen.** toggleterm gives each terminal its own
  window, so opening a second one would stack another float on top of the first; every entry
  point here closes the others first, turning the float into a single window whose occupant the
  mappings swap. `open_mapping` and `terminal_mappings` are therefore left unset -- they would
  bind `<Cmd>ToggleTerm<CR>`, which opens alongside whatever is already up -- and each key is
  bound by hand instead. In Normal mode `<C-\>` shows the terminal matching the count typed
  before it, hides the terminal when one is up, and otherwise reopens the one used last. Inside a
  terminal, `<C-\>` and `<C-q>` hide it (matching how the Claude Code terminal closes), and
  `<F1>` through `<F9>` switch to that terminal, starting it when the number is unused. Those
  are buffer-local, bound in `config()`'s `on_create`: Terminal mode passes every unbound key to
  the shell, so without them there is no way from one terminal into another -- even `<C-w>k`
  reaches zsh -- and binding them globally would collide with the `<C-q>` that `claudecode.lua`
  binds for its own terminal. The cost is that zsh loses `<C-q>` and `<C-\>` inside these
  terminals, and `<F1>` no longer opens help there (`:help` by name still works). Function keys
  were chosen over Option or Ctrl with a digit because AeroSpace binds `alt-1`..`alt-9` and herdr
  binds `ctrl+1`..`ctrl+9`, so neither ever reached Neovim (T136).
  The float's border title lists every terminal as `1 zsh 2 zsh ...` and highlights the visible
  one; it stands in for the tabline, which never lists terminals because
  `lua/config/autocmd.lua` clears their `'buflisted'`. toggleterm has no tab row of its own for a
  floating terminal, so the title is rewritten by hand on every switch. A border title is not
  clickable, so switching terminals with the mouse is no longer possible; use the keys above.
  toggleterm's own `:TermSelect` also works and picks a terminal from a list -- through
  `mini.pick`, since `minipick.lua` replaces `vim.ui.select`. It is left unbound: `<F1>`..`<F9>`
  already cover the switch. `persist_mode` is off, against its default: a terminal is always
  left in Normal mode when a function key hops away from it, and restoring that on the way back
  would strand the cursor outside Terminal mode where those keys no longer fire.
  Switching terminals reuses the window rather than closing and reopening it, which would empty
  the float for an instant and flicker. `close_on_exit` is off for the same reason: ending a shell
  with `exit` or `<C-d>` would otherwise take the whole window with it and drop the cursor back in
  the editor even with other terminals still running, so `on_exit` swaps the neighbouring terminal
  (the next one by number, or the previous one) into the standing window instead. The window is
  only given up once the last terminal is gone. Terminal mode is restored 20ms later rather than
  on the next tick, because Neovim leaves Terminal mode itself as the last step of tearing the job
  down -- anything earlier is undone by that.
  Claude Code's terminal is untouched by all of this -- it keeps its own vertical split on the
  right (`claudecode.lua`), and the float simply overlaps it while open.
- `lua/plugins/treesitter.lua`: config for `nvim-treesitter/nvim-treesitter`. Pinned to the
  `main` branch, at commit `5cb0114e6242625db56dd6440e945ed1ece10bc7` (the branch is a parser
  install/update/remove tool and a filetype-to-parser-name mapping,
  not a syntax highlighter itself -- highlighting is Neovim core's own
  `vim.treesitter.start()`, called here once a parser is confirmed installed). `lazy = true`
  with no trigger declared in the spec; instead `init()` sets up two `FileType` autocmds that
  each call `require("lazy").load({ plugins = { "nvim-treesitter" } })` before doing their own
  work, since only an autocmd can run that same load for every matching buffer, not just the
  first. The first covers ten filetypes (`rust`,
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
  opened. `config()` is an empty function: its only possible role would be changing
  `install_dir`, which already defaults to where Neovim puts things on runtimepath. Installing
  or updating a parser shells out to the `tree-sitter` CLI, which comes
  from `mise` (declared in `~/workspace/repos/dotfiles/.config/mise/config.toml`, distinct
  from the language servers in the table below) and is only on `PATH` once `mise activate`
  has run for the shell that launched Neovim. Bumping the pinned commit hash in
  this file updates the plugin's own Lua code and query files, but not the
  eight already-compiled parsers; keeping those current after such a bump needs a manual
  `:TSUpdate`.
- `lua/plugins/vimatrix.lua`: config for `wolfwfr/vimatrix.nvim` (Matrix-style Digital Rain,
  drawn as a full-screen non-focusable float), pinned to commit
  `eea0efca87dde2e83b9a744dc4f93a582586466c` (no release tag exists for this plugin) --
  see `docs/design/snacks-dashboard-vimatrix-rain.md` in the planning repository. Not loaded
  at startup; lazy-loaded through two racing paths, whichever fires first on a given session
  (lazy.nvim runs `config()` once and the other path becomes a no-op): `event = "VeryLazy"`
  (fires after startup on every session, needed so the 10-minute screensaver below is armed
  even in a session that never opens the dashboard) and `init()` listening for
  `User SnacksDashboardOpened` and calling `require("lazy").load()` itself (`event = "User ..."`
  cannot be used directly here -- lazy.nvim drops the pattern on the *first* firing of a `User`
  event it triggered by loading a plugin, so a handler registered inside `config()` would miss
  that first firing). On a no-argument launch the dashboard-open path normally wins, so Rain
  starts as soon as the dashboard appears rather than waiting for `VeryLazy`.
  Rain starts over the dashboard once `SnacksDashboardOpened` fires (guarded against the
  dashboard buffer having already been replaced by fast typeahead, e.g. `:e file<CR>` right
  after launch) and stops when the dashboard closes (`SnacksDashboardClosed` -> `:VimatrixClose`).
  `<Esc>` stops only the Rain, leaving the dashboard on screen; `q` closes the dashboard and
  Rain together. The same Rain also runs as a screensaver after 10 minutes of no input during
  normal editing, not just while the dashboard is shown (`auto_activation.screensaver.timeout =
  600`; the other four screensaver fields stay at the plugin's own defaults). The timer only
  starts after the first activity in the session, pauses on `FocusLost` and resumes on
  `FocusGained`, and does not fire while inside a terminal-mode buffer or the command line
  (plugin defaults). `:VimatrixScreenSaverStop` (a command the plugin itself defines) disables
  it for the rest of the session without restarting Neovim.
  Rain is masked to stay off the dashboard's text: every screen cell outside the dashboard
  window, plus each non-whitespace dashboard character and one cell on either side of it, is
  excluded through `window.by_filetype.snacks_dashboard.ignore_cells`, rebuilt on every
  dashboard redraw/resize. A `CursorLine`-highlighted band tracks the cursor row within that
  same rectangle (the "current item" marker `'cursorline'` would otherwise draw for the whole
  window; see `snacks.lua` above). A `nvim_set_decoration_provider` callback repaints the Rain
  glyphs that do fall inside the dashboard's rectangle at 25% of their original color, mixed
  toward the colorscheme background, without modifying vimatrix itself; it also skips any cell
  that lies under (or one cell around) another visible float such as mini.files or a mini.pick
  window, which otherwise flickered wide characters in those floats for a frame (measured 386
  changed cells over 15 samples before this guard, 0 after; T144). Because mini.pick blocks
  redraws with `getcharstr()` while a picker is open, a timer redraws the screen at Rain's own
  frame rate for as long as a picker stays open, so Rain does not appear to freeze behind it.
  The terminal cursor is hidden for the whole session while dashboard Rain is open (the plugin's
  own behavior, via `Cursor` blend 100), so this file re-shows it whenever focus leaves the
  dashboard window (another window, or the command line) and hides it again on return; the
  file-editing screensaver is left to vimatrix's own cursor handling. A terminal resize restarts
  Rain at the new size through the plugin's own `VimatrixUndo` cancellation path rather than a
  direct restart, to avoid chaining stale keymap closures across repeated resizes.
  `colourscheme = "green"` and the glyph pool (`alphabet.built_in`: half-width katakana, digits,
  symbols, upper-case Latin, binary) were picked on real hardware in T144 over the alternatives
  (`docs/design/snacks-dashboard-vimatrix-rain.md` "見た目の選定"); the `droplet` block copied
  from the README's "Recommendation for low-power systems" (lower `max_fps`, fewer glitches) is
  kept in the file, commented out, because T144 chose the plugin's own defaults (25 fps,
  glitches on) instead after seeing both on real hardware.
- `lazy-lock.json`: generated by lazy.nvim once a plugin is installed. Records the
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

## Moving to another machine

`lazy-lock.json` records the exact revision of every plugin, so a fresh checkout reproduces
this setup rather than tracking each plugin's latest commit.

1. `git pull` (or clone this repository) on the new machine.
2. Start Neovim. `install.missing = true` (`lua/config/lazy.lua`) makes lazy.nvim clone
   every plugin it is missing -- lazy.nvim itself included -- at the revision `lazy-lock.json`
   records, and shows an install screen while it does. Wait for that to finish before doing
   anything else; the parsers `nvim-treesitter` installs are a separate, later step (see
   `treesitter.lua` above) and are not part of this screen.
3. Re-link the ten `nvim-treesitter` query symlinks by hand -- `:TSInstall`/`install()` treats
   an existing (even dangling) symlink under `~/.local/share/nvim/site/queries/` as already
   installed and skips it, so it will not fix a stale link on its own:

   ```sh
   for lang in bash ecma json jsx python rust toml tsx typescript yaml; do
     ln -sfn ~/.local/share/nvim/lazy/nvim-treesitter/runtime/queries/$lang \
       ~/.local/share/nvim/site/queries/$lang
   done
   ```

4. Delete any old `vim.pack` clone still on this machine from before the lazy.nvim migration
   (`docs/design/vim-pack-to-lazy-nvim-migration.md` in the planning repository):

   ```sh
   rm -rf ~/.local/share/nvim/site/pack/core/
   ```
