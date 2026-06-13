---
paths:
  - "**/*.scala"
  - "**/*.sc"
---

# Scala Rules

## Type Safety

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Scala.

- All public API methods must have explicit return type annotations. Relying on inference for public signatures is forbidden.
- `Any`, `AnyRef`, and `asInstanceOf` are forbidden except at serialization boundaries. Narrow the type or use a proper abstraction instead.
- Use `opaque type` (Scala 3) or `newtype`-style wrappers to distinguish domain values that share a base type (e.g., `opaque type UserId = Long`).
- Enable `-Xcheck-macros` and `-Ycheck-all-patmat` in CI to catch exhaustiveness and macro issues early.

## Immutability

- Default to `val`; use `var` only when mutability is genuinely required and document why.
- Use immutable collections (`scala.collection.immutable.*`) everywhere. Import mutable collections explicitly and avoid mixing them with immutable ones.
- Model data with `case class`. Do not use regular `class` for value objects; they lack structural equality and `copy`.
- Do not mutate `case class` fields via Lens-less hacks. Use `copy(field = newValue)` or a proper optics library.

## Error Handling

- Never throw exceptions or return `null` from public functions. Model fallibility with `Either[DomainError, A]` for domain errors, or `Option[A]` for optional values.
- `Try` is acceptable for wrapping third-party code that throws; convert to `Either` at the boundary.
- Never use `return` inside methods. Express early exits with `Option`, `Either`, or for-comprehension guards.
- Every `Left` / `None` branch in a pattern match must be handled. The compiler flag `-Werror` plus exhaustiveness checking must be enabled.

## Algebraic Data Types and Pattern Matching

- Model sum types as `sealed trait` (or `sealed abstract class`) with `case class` / `case object` variants (Scala 2) or `enum` (Scala 3).
- `match` expressions over sealed types must be exhaustive. Do not add a catch-all `case _` unless it carries a meaningful default behavior with a comment.
- Prefer `match` expressions over chains of `if`/`else if` for multi-branch dispatch.

## Effects and Concurrency

- All side effects must live inside an effect type: `IO` (Cats Effect) or `ZIO`. Choose one effect system per project and apply it uniformly — do not mix them.
- Do not write raw `Future`-based side-effecting code in the core domain. Use `IO`/`ZIO` to make effects explicit and referentially transparent.
- `ExecutionContext` and thread-pool management belong at the application edge (e.g., `IOApp`, `ZIOAppDefault`). Inject them; never create ad-hoc `ExecutionContext.global` usage in business logic.
- Use `Fiber` / `ZIO.fork` for structured concurrency. Avoid `Future.foreach` with side effects; those run fire-and-forget without lifecycle management.

## Code Style and Tooling

- Format all code with `scalafmt`. Configuration lives in `.scalafmt.conf`; do not format manually.
- Run `scalafix` with `OrganizeImports` and semantic rewrites in CI.
- Enable Wartremover (or Scala 3 linting via `-Wunused`, `-Wvalue-discard`, etc.) and treat all warnings as errors (`-Werror`). Suppress a warning only with a `@SuppressWarnings` annotation and a comment.
- Target Scala 3 for new projects. Document the Scala version in `build.sbt`.

## Logging

- The rules on prohibiting debug `println` calls, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Use SLF4J as the facade and Logback as the backend via the `scala-logging` wrapper (`com.typesafe.scala-logging`). Call `LazyLogging` or `StrictLogging` as a mixin.
- In effect-typed code (Cats Effect / ZIO), prefer structured logging libraries that integrate with the effect system (e.g., `log4cats`, `ZIO Logging`).
- Control log level via environment variables (`LOG_LEVEL`, `logging.level.*`). Do not hard-code levels in source.

## Documentation

- All public types, methods, and type class instances must have a Scaladoc comment (`/** ... */`) covering behavior, parameters, return value, and thrown exceptions or error cases.
- Use `@param`, `@return`, `@throws`, and `@example` tags. Keep docs in sync with the implementation.
- Run `sbt doc` in CI and leave no missing-documentation warnings for public APIs.

## Dependency Management

- Use sbt. Pin library versions in `build.sbt` or `project/Dependencies.scala`; avoid floating version ranges in production builds.
- Lock dependency resolution with `sbt-dependency-lock` or an equivalent plugin. Commit the lock file.
- Audit transitive dependencies with `sbt-dependency-check` (OWASP) or `sbt-updates`. Resolve critical CVEs before merging.
