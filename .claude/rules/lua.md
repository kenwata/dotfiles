---
paths:
  - "**/*.lua"
---

# Lua Rules

Write Lua so that the efficient path is also the obvious path: precise names, short-lived state, explicit data flow, and no unnecessary cleverness.

## Runtime and Compatibility

- Target the Lua runtime declared by the project. Do not use syntax or APIs unavailable in that runtime.
- Treat LuaJIT as a distinct target where applicable; do not assume that features from newer standard Lua versions are available.
- Follow the repository's established naming and formatting conventions rather than introducing a competing style.

## Scope and Lifetime

- Declare names `local` by default. Create or modify globals only when an external API or framework explicitly requires it.
- Declare locals as late as practical, close to their first use, and keep their scope as narrow as the logic allows.
- Avoid long-lived mutable module state and unnecessarily captured upvalues.
- Closures should capture only the values they actually depend on.

## Tables

- Give each table a clear role: sequence, map, record, module, or explicitly documented hybrid. Do not mix roles casually.
- Use `#` only for proper sequences without holes; do not use it to determine the size of sparse tables.
- Never depend on iteration order from `pairs`.
- Preserve the distinction between `nil` and `false`; do not collapse them accidentally through truthiness checks.
- Make ownership clear when passing tables across boundaries; shared mutable tables should never be surprising.

## Functions and Expressions

- Prefer plain functions, higher-order functions, and composition over object-like metatable machinery.
- Use method syntax (`:`) only when `self` is genuinely part of the abstraction.
- Use multiple return values when they make the contract simpler and conventional. Make result expansion explicit when context could make it ambiguous.
- Do not use `a and b or c` as a ternary substitute when `b` can be `false` or `nil`.
- Avoid clever expression chains when a small named local or straightforward branch makes the semantics clearer.

## Modules and Metatables

- Keep module exports explicit and minimal; implementation details remain local.
- Keep module loading predictable. Avoid hidden work or mutation during `require` unless initialization is inherently part of the module contract.
- Use metatables only when their semantics materially improve the model. Prefer ordinary tables and functions when they express the same design clearly.
- When using metamethods, make behavior unsurprising and document non-obvious invariants or lifecycle requirements.

## Type Safety

- When LuaLS is part of the project, use LuaCATS annotations for public APIs and for shapes the analyzer cannot infer reliably: structured tables, callbacks, unions, optional values, and non-obvious return contracts.
- Prefer precise domain types and aliases over broad `table` or `any` annotations.
- Do not annotate obvious local values when inference already provides the same information.

## Comments

- Comment the parts whose meaning is not evident from the code: Lua-specific semantic traps, ownership or lifetime assumptions, metatable protocols, ordering requirements, compatibility constraints, and measured performance decisions.
- A non-obvious Lua idiom deserves either a clear name, a short explanation, or a simpler implementation.
- Do not explain syntax or restate what a well-named function or variable already says.

## Neovim Configuration

Project-specific rules for the config under `~/.config/nvim` (the real files live in
`~/workspace/repos/dotfiles/.config/nvim`). Rationale for each rule is in `plan.md`.

### Paths

- Never write a literal `~/` or `/Users/...` path. The config must work when dotfiles is
  cloned to a different location on another machine.
- When a path is genuinely needed, derive it: `vim.fn.stdpath("config")` for the config
  directory, `vim.fn.stdpath("data")` for plugin and state data.
- `require("config.general")` takes a module name, not a path, so it is portable by design.
  `vim.pack` derives its clone directory and lockfile location on its own. Neither needs a path.

### File layout

- Never place a `.lua` file directly under `lua/`. It would share the module namespace with
  plugins (`lua/general.lua` becomes `require("general")`). Put every file under
  `lua/config/`, `lua/plugins/`, or `lua/util/`.
- One responsibility per file. `init.lua` loads modules and nothing else.
- Group related options inside a file with a section comment (`-- UI`, `-- Indent`).
  Split a section into its own file once it passes ~30 lines, or the file passes ~80 lines.

### Options and mappings

- Use `vim.o.<name>` for scalar options and `vim.opt.<name>` for list- or map-style options,
  where `:append()` and `:remove()` are needed.
- Every `vim.keymap.set` call carries a `desc`. It surfaces in `:map` and in which-key style
  plugins, which is more useful than a comment.
- `vim.g.mapleader` is expanded when a mapping is defined, not when it is pressed, so it must
  be set in `init.lua` before any module that defines a `<leader>` mapping is required.

### Plugins

- Declare every plugin in a single `vim.pack.add({...})` call in `lua/plugins/init.lua`.
  Per-plugin configuration goes in `lua/plugins/<name>.lua`, one file per plugin.
- Lazy loading is the default. Load a plugin at startup only when it affects the first frame
  drawn (colorscheme, statusline). Everything else is loaded on first use via
  `vim.pack.add(..., { load = function() end })` plus `vim.cmd.packadd()` from a stub mapping,
  command, or autocommand.
- Pin a version: a semver range (`vim.version.range("0.3")`), a tag, or a commit hash.
  Leaving `version` unset follows the default branch and makes updates unreproducible.
- Keep `nvim-pack-lock.json` under version control and never edit it by hand.

### Comments

- Write comments in English.
- Explain what a group of settings is for, and why when the reason is not obvious from the
  option name. Do not comment self-explanatory lines such as `vim.o.number = true`.

### Abstraction

- Rule of three: do not extract a shared helper until the same shape appears a third time.
  The first two lazy-loaded plugins spell out their loader inline; the third one earns
  `lua/util/lazy.lua`.
