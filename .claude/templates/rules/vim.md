---
paths:
  - "**/*.vim"
---

# Vimscript Rules

Write Vimscript so that editor state, scope, and side effects are immediately visible. Prefer explicit, predictable code over compact Vimscript tricks.

## Runtime and Compatibility

- Treat `.vim` files as legacy Vimscript compatible with Neovim unless the project explicitly targets Vim instead.
- Do not use Vim9script in Neovim-targeted code.
- Prefer full, readable command names in maintained code; avoid cryptic Ex-command abbreviations.

## Scope and Lifetime

- Keep functions and variables script-local with `s:` unless they intentionally form a public or editor-wide interface.
- Use `g:`, `b:`, `w:`, and `t:` only when the value genuinely belongs to that scope.
- Keep function-local variables short-lived and declare them close to their first use.
- Avoid persistent mutable script state when the same result can be derived or passed explicitly.
- Use `<SID>` when a mapping or command must refer to a script-local function.

## Functions and Data

- Prefer small functions that receive values and return values over functions that communicate through editor or script state.
- Define functions with `abort` so unexpected errors stop the function rather than allowing execution to continue with partial state.
- Prefer Funcrefs and lambdas over expression strings when an API accepts both.
- Remember that common collection functions such as `map()`, `filter()`, `extend()`, and `flatten()` may mutate their inputs. Prefer their non-mutating variants where available, or copy explicitly before transformation.
- Do not hide mutation inside an expression whose name suggests a pure transformation.

## Options, Mappings, and Commands

- Make the scope of option changes explicit: use `setlocal` for buffer- or window-specific behavior rather than changing global state accidentally.
- Prefer non-recursive mappings (`nnoremap`, `inoremap`, etc.) unless recursive expansion is intentionally required.
- Make mappings buffer-local with `<buffer>` when their behavior belongs to a particular buffer or filetype.
- Keep user commands and mappings thin; delegate non-trivial logic to a named function.

## Autocommands

- Every maintained autocommand belongs to a named `augroup`.
- Clear the group's previous definitions before redefining them so re-sourcing a file is idempotent.
- Keep autocommand bodies small; call a script-local function when behavior requires more than a simple command.
- Scope patterns and events as narrowly as possible to avoid unrelated editor-wide effects.

## Dynamic Commands and Shell Interaction

- Avoid `execute` when a direct Vim command or function call can express the operation.
- When constructing Ex commands dynamically, escape filenames with `fnameescape()`.
- When passing values to a shell, use `shellescape()` rather than manual quoting.
- Never interpolate untrusted or externally derived text into an Ex or shell command without the appropriate escaping.

## Comments

- Comment behavior that is non-obvious because of Vimscript semantics: scope, editor-state dependencies, mapping recursion, autocommand timing, mutation, escaping, or compatibility constraints.
- Explain why an unusual Ex command or Vimscript idiom is necessary.
- Do not compensate for terse or cryptic code with comments; rewrite the code so its structure and names carry the intent.
