---
paths:
  - "**/*.hs"
  - "**/*.lhs"
---

# Haskell Rules

## Type Annotations

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Haskell.


- Every top-level binding must have an explicit type signature. Omitting it is forbidden.
- Avoid partial functions from the standard library: `head`, `tail`, `fromJust`, `read`, `!!`. Replace them with total alternatives (`listToMaybe`, `readMaybe`, safe list operations) or explicit pattern matching.
- Use `newtype` wrappers to distinguish domain values that share the same representation (e.g., `newtype UserId = UserId Int`). Never pass raw primitives where a domain type is intended.
- Leverage type classes for polymorphism, but keep instances coherent and principled. Avoid orphan instances; if unavoidable, isolate them in a dedicated module with a comment.

## Purity and Effect Isolation

- Keep the core of every module pure. Push `IO` — and all effects — to the outermost layer, following the functional core / imperative shell principle in `coding-principles.md`.
- Never use `unsafePerformIO` in application code. In library code, document the precise invariant that makes it sound with a `-- NOTE:` comment.
- Use `MonadIO`, `MonadReader`, `ExceptT`, or effect libraries (`polysemy`, `effectful`) to abstract over effects in the core — do not hard-code `IO` deep in business logic.

## Error Handling

- Return `Maybe` for optional values and `Either e a` for computations that can fail with a domain error. Use `ExceptT` to thread errors through monadic pipelines.
- `error` and `undefined` are forbidden in production code. Use `throwIO` (for `IO`) or return a meaningful error value.
- Never ignore `Left` / `Nothing` branches in a pattern match. The compiler warning `-Wincomplete-patterns` must be kept enabled.

## Laziness and Strictness

- Understand that `foldl` leaks space; use `foldl'` from `Data.List` for strict left folds over large lists.
- Mark accumulator fields and performance-critical record fields as strict (`!`) to prevent thunk build-up.
- Enable `{-# LANGUAGE BangPatterns #-}` or use `$!` only where profiling confirms a space leak. Do not add strictness annotations speculatively.

## Code Style and Tooling

- Format all code with `fourmolu` (preferred) or `ormolu`. Configuration lives in `fourmolu.yaml`; do not format by hand.
- Run `hlint` in CI. Address suggestions or explicitly ignore them with `{-# ANN ... HLint.ignore #-}` and a comment.
- Compile with `-Wall -Wcompat` in CI, and promote warnings to errors with `-Werror`. Never suppress a warning without a documented reason.
- Organize module exports explicitly in the `where` clause of each module header. Avoid `module Foo where` with no export list — it exports everything.

## Concurrency

- Use the `async` library (`Control.Concurrent.Async`) for structured concurrency. Prefer `concurrently`, `race`, and `mapConcurrently` over raw `forkIO`.
- Share mutable state with `STM` (`TVar`, `TMVar`) rather than `MVar` wherever possible. `STM` transactions compose; `MVar` operations do not.
- Never call blocking FFI functions from within an `async` task without wrapping them in `threadWaitRead`/`threadWaitWrite` or the `safe` FFI convention.

## Logging

- The rules on prohibiting debug `putStrLn` / `print` calls, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Use `katip` (preferred for structured logging) or `co-log`. Initialize the logging environment once at `main` and thread it through the application via `ReaderT` or a similar pattern.
- Control log level via an environment variable (e.g., `LOG_LEVEL`). Do not hard-code levels in source.

## Documentation

- Every exported function, type, and type class instance must have a Haddock comment (`-- |`). Explain what it does, any preconditions, and the meaning of arguments and return values.
- Use `-- ^` for trailing parameter documentation in multi-argument functions.
- Run `cabal haddock` in CI and leave no missing-documentation warnings for public modules.

## Dependency Management

- Use Cabal or Stack (choose one per project). Commit `cabal.project.freeze` (Cabal) or `stack.yaml.lock` (Stack) to pin exact versions.
- Keep the `.cabal` file `build-depends` bounds tight enough to be meaningful, but avoid overly restrictive upper bounds that break with minor library updates.
- Audit transitive dependencies for known vulnerabilities with `cabal-audit` or `stack-audit` when available.
