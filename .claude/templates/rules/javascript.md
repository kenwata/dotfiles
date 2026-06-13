---
paths:
  - "**/*.js"
  - "**/*.jsx"
  - "**/*.ts"
  - "**/*.tsx"
  - "**/*.mjs"
  - "**/*.cjs"
---

# JavaScript Rules

## Type Safety (TypeScript first)

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including JavaScript/TypeScript.

- New code must be written in TypeScript. Plain JavaScript is reserved for existing assets and small one-off scripts.
- When writing plain JS, add `// @ts-check` at the top of each file, or enable `checkJs` in `jsconfig.json`, and annotate types with JSDoc.
- `any` (or `@type {any}`) is forbidden in principle. If truly unavoidable, add a comment explaining why. Prefer `unknown` instead.
- Run `tsc --noEmit` in CI and keep it error-free. TypeScript-specific rules (strict mode, `tsconfig` settings, etc.) will be covered in a separate `typescript.md`.

## Variable Declaration & Equality

- `var` is forbidden. Default to `const`; use `let` only when reassignment is truly necessary.
- Use `===` / `!==` for all comparisons. `==` / `!=` are forbidden (implicit type coercion).
- Use `??` (nullish coalescing) for default values, not `||`. `||` silently swallows `0`, `''`, and `false`.
- Use `?.` (optional chaining) to guard property access instead of manual `!= null` checks.

## Modules (ESM)

- Use ES Modules (`import` / `export`). CommonJS (`require` / `module.exports`) is forbidden in new code.
- Prefer named exports over `export default`. Named exports are rename-safe, IDE-friendly, and easier to re-export.
- Avoid wildcard re-exports and circular dependencies. Declare `"type": "module"` in `package.json` to enforce ESM.

## Async & Promises

- Write async logic with `async`/`await`. Avoid nested callbacks and long `.then()` chains.
- Never create floating Promises. Every Promise must be `await`ed or have a `.catch()` handler. Enable `no-floating-promises` in ESLint.
- Parallelize independent async operations with `Promise.all` / `Promise.allSettled`. Avoid unnecessary sequential `await`.
- Use `for await...of` only when loop-body ordering matters. Never use `async` callbacks inside `forEach` — they are not awaited.

## Error Handling

- Always `throw` an `Error` instance (or a subclass). Never throw strings or plain objects.
- Represent domain-specific errors with custom classes that extend `Error`. Set `this.name` and use the `cause` option to chain the original error.
- Never silently swallow caught errors. Either re-throw, log, or recover — an empty `catch` block is forbidden.
- In `catch (e)`, treat `e` as `unknown` and narrow the type before using it.
- In Node, listen for `process.on('unhandledRejection', ...)`. In browsers, listen for `window.addEventListener('unhandledrejection', ...)` to catch unhandled Promise rejections at the top level.

## Data & Collections

- Use `Map` for dynamic-key dictionaries and `Set` for unique collections instead of plain objects.
- Shallow-copy arrays and objects with spread. For deep copies, use `structuredClone`. Do not write custom recursive copy utilities.
- Use `Number.isNaN` / `Number.isInteger`. The global `isNaN` is forbidden (it coerces its argument).
- Always pass a radix to `parseInt` (e.g., `parseInt(s, 10)`), or use `Number()` instead.
- Iterate with `for...of` or array methods. `for...in` is forbidden (enumerates prototype chain, ordering is unreliable).

## Modern Syntax & Pitfalls

- Default to arrow functions. Use regular functions only when `this` binding is required (e.g., class methods, object methods that reference `this`). Never rely on implicit `this` binding.
- Use destructuring, default parameters, and template literals. Avoid string concatenation with `+`.
- ESM is strict mode by default — never declare implicit globals. If a variable is missing a declaration, that is a bug, not a shortcut.
- Avoid `delete` for removing properties; return a new object without the key instead (immutability — see `coding-principles.md`).

## Code Style & Tooling

- Delegate all formatting to Prettier. Manual formatting is forbidden.
- Use ESLint with flat config (`eslint.config.js`). For TypeScript projects, add `typescript-eslint`. Key rules to enable: `eqeqeq`, `no-var`, `no-floating-promises`, `no-unused-vars`.
- Run `tsc --noEmit` (TS) or `checkJs` (JS) plus ESLint in CI. Zero errors and zero lint warnings is the bar.
- Auto-sort imports with the `import/order` ESLint rule or a Prettier plugin. Do not maintain import order by hand.

## Logging

- The rules on prohibiting `console.log` debugging, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Never leave `console.log` calls in production code for debugging purposes. Use a structured logger.
  - **Node**: Use `pino` (preferred) or `winston`. Centralize logger creation and configuration in one module; each file imports from it.
  - **Browser**: Use the leveled `console` API (`debug` / `info` / `warn` / `error`). Remove debug-level logs at build time via environment variables or the bundler's dead-code elimination.
- Control debug mode with environment variables (`DEBUG`, `LOG_LEVEL`, etc.). Do not hard-code levels in source.

## Dependency Management

- Standardize on one package manager (npm, pnpm, or yarn) per project. Commit the lock file (`package-lock.json`, `pnpm-lock.yaml`, or `yarn.lock`) to pin versions.
- Declare the supported Node version in `package.json` `engines`. Align the development environment with `.nvmrc` or `.node-version`.
- Audit dependencies regularly with `npm audit` (or equivalent). Remove unused packages promptly.
