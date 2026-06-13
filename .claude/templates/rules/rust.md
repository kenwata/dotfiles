---
paths:
  - "**/*.rs"
---

# Rust Rules

## Ownership and Types

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Rust.

- Prefer borrowing over cloning. Avoid gratuitous `clone()` calls; treat each one as a design smell to justify.
- Annotate lifetimes only when the compiler cannot infer them. Keep lifetime annotations minimal and close to their use site.
- Use specific types everywhere. Avoid `Box<dyn Any>` or overly wide trait objects when a concrete type or a narrower trait suffices.
- Leverage the type system to make illegal states unrepresentable: use `newtype` wrappers for domain values, and enums for states.

## Safety

- `unsafe` code is forbidden except when wrapping a C FFI boundary or implementing a fundamental data structure. Every `unsafe` block must have a `// SAFETY:` comment explaining the invariant that makes it sound.
- Do not use `std::mem::transmute` or pointer casts unless absolutely necessary; document why no safe alternative exists.

## Error Handling

- All fallible operations return `Result`; all absent values return `Option`. Do not panic in library code.
- `unwrap()` is forbidden in production code. `expect("reason")` is allowed only in tests and for invariants that are genuinely impossible to violate — the message must state why.
- Use `?` to propagate errors. Do not manually `match` on `Err` just to re-wrap.
- For libraries, define domain errors with `thiserror`. For application binaries, use `anyhow` for ergonomic error context.
- Never silently discard errors. An ignored `Result` must be explicitly acknowledged with `let _ =` and a comment.

## Immutability and Patterns

- `let` bindings are immutable by default. Introduce `mut` only when genuinely needed; keep its scope as narrow as possible.
- `match` arms must be exhaustive. Avoid `_` catch-alls that hide unhandled variants; add a `todo!()` or a compile-time guard instead.
- Prefer iterators and combinators (`map`, `filter`, `fold`) over imperative loops when it improves clarity.

## Code Style and Tooling

- Run `rustfmt` before every commit. Configuration lives in `rustfmt.toml`; do not format by hand.
- Run `cargo clippy -- -D warnings` in CI. Zero warnings is the bar; suppress a lint only with `#[allow(...)]` accompanied by a comment.
- Enable `#![deny(missing_docs)]` for library crates.
- Specify a `rust-edition` in `Cargo.toml`; default to `2021` or `2024` for new projects.

## Concurrency

- Prefer `async`/`await` over threads for I/O-bound work. Choose one async runtime (e.g., `tokio`) and use it consistently across the project.
- Share data across threads with `Arc<Mutex<T>>` or `Arc<RwLock<T>>`. Do not use raw `unsafe` concurrency primitives when safe alternatives exist.
- Respect `Send` and `Sync` bounds. If a type must be `Send`/`Sync`, enforce it with a compile-time assertion rather than a comment.
- Avoid blocking calls inside `async` functions; use `spawn_blocking` to offload CPU-heavy or blocking-I/O work.

## Logging

- The rules on prohibiting debug `println!` calls, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Use `tracing` (preferred) for structured, async-aware logging. For simple cases, use the `log` facade with a concrete backend (e.g., `env_logger`, `tracing-subscriber`).
- Initialize the subscriber/logger once at the application entry point. Library crates must never install a global subscriber; emit events through the `log`/`tracing` facades only.
- Control log level via the `RUST_LOG` environment variable.

## Documentation

- Every public item (function, struct, enum, trait, module) must have a `///` doc comment explaining what it does, its parameters, return value, and any panics or errors.
- Include at least one `# Examples` section with a runnable doctest for non-trivial public APIs. Run `cargo test --doc` in CI.
- Build docs with `cargo doc --no-deps` in CI and leave no warnings.

## Dependency Management

- Commit `Cargo.lock` for application binaries; omit it from version control for libraries (but keep it locally for reproducible dev builds).
- Audit dependencies regularly with `cargo audit`. Investigate and resolve `RUSTSEC` advisories promptly.
- Keep the dependency tree lean: prefer std or well-audited crates over adding heavy transitive dependencies for minor conveniences.
