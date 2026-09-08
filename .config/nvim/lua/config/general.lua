-- UI
vim.o.number = true
-- Absolute numbers on every line: knowing where a line sits in the file was judged more
-- useful than counting relative distances for motions such as 8j.
vim.o.relativenumber = false
-- Long lines stay readable without scrolling sideways; breakindent and linebreak below
-- shape how they fold.
vim.o.wrap = true
vim.o.list = true
-- listchars holds a table value, which vim.o cannot accept.
vim.opt.listchars = { space = "·", tab = "▸ ", trail = "·", eol = "↲" }
-- Keep the sign column always present. With "auto" the text shifts two cells sideways the
-- moment a diagnostic appears and back when it clears.
vim.o.signcolumn = "yes"
-- Highlight the whole cursor line (cursorlineopt stays at its default "both"): marking only
-- the line number was tried and read as too faint to locate the cursor.
vim.o.cursorline = true
-- Lines kept above and below the cursor, so what comes next is visible before reaching it.
-- Ten was picked over a smaller margin by watching both on screen; it keeps roughly a third
-- of a 30-row window as lookahead without dragging the cursor to the middle.
vim.o.scrolloff = 10
-- A border makes a hover or diagnostic popup distinguishable from the buffer underneath.
vim.o.winborder = "rounded"
-- A wrapped line continues at the indent of its first row and breaks between words rather
-- than mid-token. Both only matter while wrap is on.
vim.o.breakindent = true
vim.o.linebreak = true
-- One status line for the whole screen instead of one per window, which gives split layouts
-- their rows back and leaves room for the full path.
-- Note for a future lualine: its options.globalstatus defaults to `vim.go.laststatus == 3`,
-- so this line is what makes lualine keep a global status line rather than fight it.
vim.o.laststatus = 3
-- Put the file name in the terminal title so Ghostty tabs are distinguishable.
vim.o.title = true

-- Window
-- New splits open right and below, matching the direction text flows.
vim.o.splitright = true
vim.o.splitbelow = true

-- Indent
vim.o.expandtab = true
-- Four columns per indent level, applied to tab display, >> shifts, and <Tab> in insert mode
-- alike so the three cannot drift apart.
vim.o.tabstop = 4
vim.o.shiftwidth = 4
vim.o.softtabstop = 4
-- Round >> and << to a multiple of shiftwidth instead of adding a fixed amount to a line
-- that is already off-grid.
vim.o.shiftround = true

-- Search
vim.o.hlsearch = true
vim.o.incsearch = true
-- Case-insensitive by default; typing an uppercase letter switches a search back to
-- case-sensitive (smartcase). Popup-menu completion follows the same setting
-- (see :help compl-ignore-case), which is why this lives here rather than under
-- Completion below.
vim.o.ignorecase = true
vim.o.smartcase = true

-- Editing
-- Let blockwise visual selection extend past the end of a line; other modes keep the cursor
-- on real characters.
vim.o.virtualedit = "block"
-- Quitting with unsaved changes asks whether to write instead of failing with E37.
vim.o.confirm = true
-- Undo history survives closing the file, stored under stdpath("state").
vim.o.undofile = true

-- Timing
-- Milliseconds to wait for the rest of a mapping. Shorter than the 1000 default so a lone j
-- responds promptly; jj (insert and terminal mode) still completes at a normal typing pace.
vim.o.timeoutlen = 500
-- Milliseconds of idle time before CursorHold fires and the swap file is written. The 4000
-- default predates plugins that react to the cursor resting; 300 is short enough to feel
-- immediate while staying above the pause between keystrokes in normal typing.
vim.o.updatetime = 300

-- Clipboard
-- Yank and delete reach the system clipboard, so text moves between Neovim and other
-- applications without a register prefix.
vim.o.clipboard = "unnamedplus"

-- Encoding
-- Candidates are tried in order when opening a file. ucs-bom comes first so a
-- BOM is honoured before any heuristic runs; cp932 covers legacy Japanese files.
vim.o.fileencodings = "ucs-bom,utf-8,cp932"

-- Completion
-- Built-in autocompletion (no plugin): pop up candidates while typing.
vim.o.autocomplete = true
-- Prepend "o" (omnifunc, wired to the LSP client automatically) so language-server
-- candidates get priority; see :help ins-autocompletion on source ordering.
vim.opt.complete:prepend("o")
-- Plain prefix matching (no "fuzzy"): fuzzy matching on a short prefix (e.g. "os.pa")
-- ranked unrelated candidates that merely contain the same letters in order (e.g.
-- EX_TEMPFAIL) above the intended os.path. noselect shows the menu without
-- pre-selecting anything, so nothing is inserted until confirmed.
vim.opt.completeopt:append("noselect")
-- The default "menu" hides the popup as soon as a single candidate remains, so narrowing
-- "std::pr" (5 matches) to "std::pro" (only process) made the menu vanish with nothing
-- inserted. menuone keeps it open for a lone match.
vim.opt.completeopt:append("menuone")
-- Cap the popup at ten rows: with autocomplete on, the uncapped default (0) lets a widely
-- matching prefix cover most of the screen. Ten fills about a third of a 30-row window,
-- enough to judge the candidates without hiding the code being edited.
vim.o.pumheight = 10
