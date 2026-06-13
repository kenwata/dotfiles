---
paths:
  - "**/*.rb"
---

# Ruby Rules

## Type Signatures

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Ruby.

- Every public method must have a type signature. Use RBS (preferred for new projects) or Sorbet (`sig { ... }`) and enforce type checking in CI (`steep check` / `srb tc`). Choose one tool per project and apply it consistently.
- Do not leave public methods without signatures. Private helpers may omit signatures only when the types are completely obvious from context; document them if not.
- Represent domain values with `T::Struct` (Sorbet) or typed `Data`/`Struct` subclasses — not plain hashes — so types are checkable.

## Code Style and Tooling

- Add `# frozen_string_literal: true` to the top of every Ruby file. This prevents accidental string mutation and improves performance.
- Run RuboCop (or `standard`) in CI with zero offenses. Store configuration in `.rubocop.yml`. Disable a cop only with an inline `# rubocop:disable` comment that names the reason.
- Enable `rubocop-rspec`, `rubocop-rails`, or other extension gems that match the project stack.
- Do not format code by hand; rely entirely on RuboCop's auto-correct (`--autocorrect`).

## Immutability and Safe Patterns

- Freeze all top-level constant values: `RATES = { standard: 0.1 }.freeze`.
- Avoid mutating method arguments. If transformation is needed, build and return a new object.
- Use the bang (`!`) version of a method only when in-place mutation is the intentional, documented behavior. Prefer the non-bang version when the caller needs the result.
- Avoid monkey-patching core classes. If an extension is unavoidable, confine it to a `Refinements` module and `using` it explicitly.

## Error Handling

- Custom exception classes must inherit from `StandardError`, not `Exception`. `rescue Exception` is forbidden — it catches signals and interpreter errors.
- Bare `rescue` (with no exception class) is forbidden. Always specify the exception class: `rescue ActiveRecord::RecordNotFound`.
- Never swallow exceptions silently. Every `rescue` must log, re-raise, or return a meaningful error value.
- Represent recoverable domain errors as typed objects (value objects or dry-rb `Result` types) rather than relying solely on exception flow.

## Safe Idioms

- Use the safe navigation operator (`&.`) to guard against `nil` on method chains: `user&.profile&.avatar_url`.
- Access hash values with `fetch` (or `dig` with a default) when a missing key is an error: `config.fetch(:timeout)`. Do not use `[]` silently when absence is unexpected.
- Prefer `frozen_string_literal` + symbol keys for internal hashes. Use string keys only for external data (JSON, params).
- Prefer `map`, `select`, `reject`, `reduce`, and `each_with_object` over manual loops. Avoid `for` loops.

## Naming Conventions

- Predicate methods (return boolean) must end with `?`: `valid?`, `persisted?`.
- Mutating / bang methods must end with `!`: `save!`, `upcase!`.
- Use `snake_case` for methods and variables, `CamelCase` for classes and modules, `SCREAMING_SNAKE_CASE` for constants.
- Prefer full words over abbreviations in names. Reserve single-letter names for conventional block variables (`|e|`, `|k, v|`).

## Modern Ruby Idioms (3.x)

- Use pattern matching (`case / in`) for structural deconstruction instead of chains of conditional guards.
- Use numbered block parameters (`_1`, `_2`) only for trivial one-liner blocks; named parameters are clearer for anything non-trivial.
- Use `Data.define` for immutable value objects in Ruby 3.2+.
- Avoid `Struct.new` for new code when `Data.define` or a typed class is more appropriate.

## Logging

- The rules on prohibiting debug `puts` / `p` calls, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Use Ruby's standard `Logger` class or a structured logger (`semantic_logger`, `lograge` for Rails). Do not leave `puts` or `p` calls in production code.
- Obtain loggers at the class level: `logger = Logger.new($stdout)` in plain Ruby, or `include SemanticLogger::Loggable` in the class.
- Control log level via environment variable (`LOG_LEVEL`). Do not hard-code levels in source.

## Documentation

- Document every public method and class with YARD: `# @param`, `# @return`, `# @raise`, `# @example`.
- Run `yard doc` and `yard stats --list-undoc` in CI. Keep undocumented public API at zero.
- Keep docs in sync with the implementation; stale or misleading YARD comments are a bug.

## Dependency Management

- Use Bundler. Commit `Gemfile.lock` to pin exact gem versions and ensure reproducible installs.
- Audit dependencies with `bundler-audit` in CI (`bundle-audit check --update`). Resolve vulnerabilities before merging.
- Declare Ruby version in `.ruby-version` and `Gemfile` (`ruby "~> 3.x"`). Keep the development environment in sync.
