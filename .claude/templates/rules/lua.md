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
