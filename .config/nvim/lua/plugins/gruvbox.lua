-- gruvbox.nvim is loaded at startup, not on first use: a colorscheme affects the very first
-- frame drawn, so deferring it would show Neovim's default colors until something triggered
-- the load (see .claude/rules/lua.md Plugins section).
return {
  "ellisonleao/gruvbox.nvim",
  version = "2",
  lazy = false,
  -- lualine.nvim's setup() resolves this theme via require("gruvbox") (lua/plugins/lualine.lua),
  -- so gruvbox must finish loading -- runtimepath added, config run -- before lualine's own
  -- config runs. priority controls startup-load ordering among lazy = false plugins
  -- (loader.lua), which is what lualine's own dependency on "gruvbox.nvim" relies on.
  priority = 1000,
  config = function()
    -- vim.o.termguicolors is deliberately not set anywhere in this config: gruvbox's load() sets
    -- it unconditionally, and Neovim enables it on its own when the terminal supports 24-bit
    -- color.

    vim.o.background = "dark"

    -- Colours for the overrides further down are taken from gruvbox's own exported palette
    -- rather than written as hex literals, so they keep following the colorscheme's definition
    -- of "green". background must be set before this: gruvbox reads it at the moment it builds
    -- its palette.
    local palette = require("gruvbox").palette

    -- Every option gruvbox.nvim accepts is listed, including the ones left at their default, so
    -- that the file records a choice rather than an omission.
    require("gruvbox").setup({
      terminal_colors = true,
      undercurl = true,
      underline = true,
      bold = true,
      italic = {
        strings = true,
        emphasis = true,
        comments = true,
        operators = false,
        folds = true,
      },
      strikethrough = true,
      invert_selection = false,
      invert_signs = false,
      invert_tabline = false,
      inverse = true,
      contrast = "",
      palette_overrides = {},
      -- mini.pick links its current-item highlight to CursorLine, which gruvbox paints the same
      -- #3c3836 as NormalFloat. That leaves the selected entry indistinguishable from the rest
      -- of the picker. PmenuSel is this colorscheme's own treatment for the selected entry of a
      -- list, so the picker borrows it and keeps following the colorscheme if it ever changes.
      overrides = {
        MiniPickMatchCurrent = { link = "PmenuSel" },
        -- mini.files links its explorer cursor line to CursorLine, the same #3c3836 as its float
        -- background, so the current entry had no visible band (only the cursor marked it, and the
        -- dashboard's Rain hides the cursor). Same treatment as the picker above, so both mini.nvim
        -- lists mark the current entry alike (T144, user decision 2026-09-17). mini.files defines
        -- its groups with default = true, so this override wins.
        MiniFilesCursorLine = { link = "PmenuSel" },
        -- Dashboard colours picked on real hardware in T144 (user decisions 2026-09-17,
        -- docs/design/snacks-dashboard-vimatrix-rain.md "見た目の選定"): every snacks dashboard group
        -- in the blue family, three shades -- bright for the logo, section titles, file names and
        -- the startup numbers; neutral for keys, icons and the startup text. Item descriptions
        -- ("Find File" ...) use the body text colour and path prefixes light4 instead of
        -- faded_blue, which sits at a 2.23:1 contrast against the dark0 background. snacks
        -- defines these as default links on UIEnter, after this colorscheme has loaded, so the
        -- overrides win.
        SnacksDashboardHeader = { fg = palette.bright_blue },
        SnacksDashboardTitle = { fg = palette.bright_blue, bold = true },
        SnacksDashboardFile = { fg = palette.bright_blue },
        SnacksDashboardSpecial = { fg = palette.bright_blue },
        SnacksDashboardKey = { fg = palette.neutral_blue },
        SnacksDashboardIcon = { fg = palette.neutral_blue },
        SnacksDashboardFooter = { fg = palette.neutral_blue },
        SnacksDashboardDesc = { fg = palette.light1 },
        SnacksDashboardDir = { fg = palette.light4 },
        -- mini.tabline links both MiniTablineCurrent and MiniTablineVisible to TabLineSel, so
        -- the buffer being edited and a buffer merely shown in another split are drawn
        -- identically. Splitting them: the current tab reverses into a solid green block, and
        -- "visible" keeps what the current tab used to look like -- green text on the ordinary
        -- tab background. The block also gives the current tab a visible edge against its
        -- neighbours.
        MiniTablineCurrent = { fg = palette.dark0, bg = palette.bright_green, bold = true },
        MiniTablineVisible = { fg = palette.bright_green, bg = palette.dark1 },
        -- The modified variants link to StatusLine / StatusLineNC by default, which in this
        -- colorscheme are pale bars (#ebdbb2 and #a89984). With laststatus = 3 the status line
        -- sits one row below the tabline, so an unsaved tab read as an echo of it. Yellow moves
        -- the hue away from the status line while still reading as "needs attention".
        MiniTablineModifiedCurrent = { fg = palette.dark0, bg = palette.bright_yellow, bold = true },
        MiniTablineModifiedVisible = { fg = palette.bright_yellow, bg = palette.dark1 },
        MiniTablineModifiedHidden = { fg = palette.neutral_yellow, bg = palette.dark1 },
        -- nvim-surround marks the text about to be surrounded with NvimSurroundHighlight, which
        -- it links to Visual by default. Visual's bg3 sits at a 1.8:1 contrast against
        -- CursorLine's bg1 (measured 2026-09-11), so a single highlighted word was barely
        -- distinguishable from the cursor line. Search is this colorscheme's own "this range,
        -- right now" treatment (yellow block, 6.8:1). Defining it here works because the plugin
        -- uses `highlight default link`, which yields to a group that already exists when the
        -- plugin is loaded.
        NvimSurroundHighlight = { link = "Search" },
        -- gruvbox defines only the 3 unstaged gitsigns groups (Add/Change/Delete). gitsigns
        -- derives each staged-hunk group from its unstaged counterpart by halving the foreground
        -- toward black on a dark background (lua/gitsigns/highlight.lua: fg_factor = 0.5 for
        -- staged), so by default a staged sign is a dimmed copy of the unstaged color. These
        -- overrides give staged signs the same gruvbox color as unstaged ones instead, so the
        -- sign column does not show whether a hunk is staged: chosen after comparing this, the
        -- dimmed default, and gruvbox's neutral_* colors on the real terminal. The staged side
        -- derives Topdelete and Changedelete separately rather than linking them to Delete/Change
        -- (unlike the unstaged side), so each of the 5 needs its own override here rather than 3.
        GitSignsStagedAdd = { link = "GruvboxGreenSign" },
        GitSignsStagedChange = { link = "GruvboxAquaSign" },
        GitSignsStagedDelete = { link = "GruvboxRedSign" },
        GitSignsStagedTopdelete = { link = "GruvboxRedSign" },
        GitSignsStagedChangedelete = { link = "GruvboxAquaSign" },
      },
      dim_inactive = false,
      transparent_mode = false,
    })

    vim.cmd.colorscheme("gruvbox")
  end,
}
