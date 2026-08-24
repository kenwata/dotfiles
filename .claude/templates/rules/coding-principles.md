---
---

# Coding Principles

## 0. Foundation

Build on pure functions, immutable data, and composition (functional core / imperative shell), with SOLID applied on top as the design of boundaries. When in doubt, choose the option that is *easier to test* and *has fewer side effects*.

Priority on conflict: **correctness > testability > readability > simplicity > abstraction**. Prefer duplication over premature abstraction.

## 1. Pure Functions and Side-Effect Isolation

- Default to pure functions: same input → same output, no reading or writing of external state.
- Immutability: never mutate values or arguments; return new ones. Question any reassignment.
- Isolate side effects at the boundary: push I/O, network, randomness, current time, and global state out of the pure core into the outermost shell.
- Inject side effects as dependencies and receive them as arguments; never hide dependencies inside a function.

## 2. No Magic Numbers / Magic Strings

- If a literal carries meaning, make it a named constant; express unit, meaning, and origin through the name.
- Extract to a constant once the same value appears in two or more places. Move environment-dependent values into config.
- Exceptions: self-evident `0` / `1` / empty string, fixed values in tests, and anything whose meaning is obvious from context.

## 3. SOLID in FP Terms

One responsibility per function — keep functions small and don't mix data transformation with I/O; extend via higher-order functions, composition, and data-driven design rather than rewriting; honor the contract of types and signatures, keeping types narrow; take only the arguments you need; depend on abstractions and inject side effects.

## 4. Test-Driven Development

Defined in `testing.md` (test-first: Red → Green → Refactor).

## 5. Write Modern Code

- Follow the language's latest official style guide and standard idioms; don't use deprecated or legacy APIs.
- Keep the code in a state where formatter, linter, and type checker all pass; don't format by hand. Prefer immutable bindings, declarative constructs (map/filter/reduce) where readability doesn't suffer, and the language's current async conventions (async/await, etc. — no callback hell).

## 6. Supporting Principles

- Naming: intention-revealing names; let the name speak rather than patching it with a comment.
- Early return / guard clauses to keep nesting shallow.
- Treat errors as values where possible (Result / Either); reserve exceptions for genuinely exceptional events. Respect the language's conventions.
- Inline comments explain "why"; don't restate the "what" the code already shows (API descriptions and intent comments are made mandatory in §8).
- YAGNI: don't generalize for needs you don't have yet. Apply DRY to duplication of *meaning*; don't force coincidental matches together.

## 7. Type Discipline — Never Leave Types Ambiguous

Applies to **all languages**, statically and dynamically typed alike. Where full static enforcement is impractical, apply it best-effort; the target is a **type-checked codebase**, not merely an annotated one.

- Types are machine-verifiable contracts. Treat a value whose type does not precisely constrain what it can be as a defect.
- Make types explicit and as narrow as the domain allows. Avoid wide-escape types (`any`, `Object`, raw/unparameterized collections, untyped dicts/hashes) and inference at public API boundaries. Prefer `unknown` over `any` when a type must remain open.
- In dynamically typed languages, use native annotation mechanisms (Python type hints, TypeScript for JS, RBS/Sorbet for Ruby) and run the corresponding static checker in CI with zero errors as the bar — annotation alone is insufficient.
- Escape hatches (`any` / `Any` / `asInstanceOf` / raw types / `Box<dyn Any>`) are a last resort, never a default. Where a dynamic boundary (serialization, reflection, FFI) makes them unavoidable, confine them to the smallest scope and document why.
- Make illegal states unrepresentable: `newtype` / opaque / branded wrappers for domain values sharing a base representation (`UserId ≠ Long`); enum / sum types for fixed choices; `Option`/`Maybe`/`T | null` for optionality; `Result`/`Either` for failures — never sentinel values or nullable primitives.
- Public functions, methods, and top-level bindings carry explicit parameter and return types even when inference could deduce them. Inference is for local bindings only.
- Best-effort is not zero-effort: in legacy assets or inherently dynamic boundaries, match the file's established conventions, flag gaps explicitly, and tighten coverage incrementally — never abandon the goal.

Language-specific enforcement (forbidden constructs, required tooling, CI commands) is defined in each language file's **Type Safety** or **Type Annotations** section.

## 8. Documentation (mandatory)

- Documentation on classes and functions is mandatory, in the language's standard format (Python: docstring / PEP 257; JS/TS: JSDoc / TSDoc; Java: Javadoc; Go: doc comment; Rust: `///`; etc.).
- Write the **contract** the caller needs: what it does, the meaning of parameters and return value, and (where applicable) side effects, exceptions thrown, and preconditions — not a line-by-line restatement of the implementation.
- Strictly required for public classes and functions. Even a small private helper gets a one-line note if its intent isn't self-evident.
- Comment variables and constants with what they are for: intent, unit, constraints, and "why this value". Express what a name can carry through the name (§2); use a comment for the background a name can't.
- Keep documentation in sync with the code; when a signature or behavior changes, update the description. Never leave stale docs.

## 9. Application Policy

- When editing existing code, prioritize that file's established conventions (formatter settings, naming, patterns). If they conflict with these principles, say so first, then either match them or confirm with the user.
- On noticing existing code that violates these principles, don't perform a large unrequested refactor beyond the task's scope; point it out and offer a minimal fix.

## 10. Exception Handling — Be Specific, Leave No Gap

- Catch the narrowest exception type possible. `except Exception`, `catch (Exception e)`, `rescue StandardError`, etc. are forbidden as a default catch-all; name the exact condition you handle.
- Every caught exception must be handled meaningfully: log, re-raise, convert to a domain error, or surface to the caller. Silent swallowing (`except ...: pass`, empty `catch {}`) is forbidden.
- Identify every path that can throw or fail, and decide explicitly what happens in each case.
- Wrap low-level errors (I/O, network, parse failure) in domain-specific exception types; callers should not need to know the underlying library.
- Let truly unexpected exceptions propagate: don't catch errors you cannot handle at the current layer; let them surface to a boundary (top-level handler, middleware, main) that can log and decide.

## 11. Environment Independence

- Assume the code runs on Linux, macOS, and Windows unless the target is explicitly single-platform; never rely on OS-specific behavior without an explicit guard.
- Never hardcode path separators; use the language's path library (`pathlib.Path`, `path.join`, `std::path::Path`, etc.).
- Never assume a fixed home directory, temp directory, or file-system layout; use the standard APIs and test with both absolute and relative inputs.
- Avoid shell-isms: guard or abstract shell commands, shebang lines, and OS-dependent environment variables; prefer language-native APIs over subprocess/shell calls.
- Test platform-sensitive paths in CI across at least the platforms the project targets.

## 12. Impact Analysis — Verify the Full Blast Radius Before Changing

- Before editing any function, type, or module, identify every direct caller with search tools (grep, IDE references, `git log -S`) — don't rely on memory.
- Trace transitively (consumers of consumers) until you reach a stable boundary: entry point, public API, external contract.
- Check implicit dependencies: serialized data formats, database schemas, environment variables, configuration keys, and wire protocols are contracts even without a type-level link.
- If the impact is larger than expected, surface that to the user and agree on scope before proceeding.
- When a known affected site is deliberately not updated in the current change, call it out explicitly (comment, PR description, or follow-up task).

## 13. Modularization

- One responsibility per module/file; split along clear conceptual boundaries (domain, layer, feature).
- Extract name-worthy logic into its own function, class, or file; don't leave it as an anonymous blob inside a larger routine.
- Mirror structure to domain, not file type (`feature/auth/{model,service,handler}.py` over `models/auth.py + services/auth.py`) unless the framework mandates otherwise. Group by what changes together.
- Keep directory depth proportional to project size: two or three levels usually suffice; a flat module list grown unmanageable calls for one layer of grouping, not five.
- Expose only what callers need, as an explicit public interface: mark internal helpers private (`_prefix`, `private`, `internal`) and declare public exports explicitly (`__all__`, `pub`, `export`).
- No circular imports/dependencies; extract the shared concern into a third module neither imports.
- **Standard layout first**: follow the language/framework's standard layout when one exists (Cargo `src/`; Python `src/<pkg>/` + `tests/`; Go `cmd/` + `internal/`; Rails; Next.js App Router; etc.). Only fall back to a generic `src/` `tests/` `docs/` `scripts/` layout when no standard applies.
- **Domain first, kind second**: the first level of splitting is the domain (`src/users/`, `src/billing/`); the kind of code (model/service/handler/repository) is a level *inside* the domain — `src/users/{models/,services/,repository.py}`, not `src/{models,services}/users.py`.
- **Deepen gradually**: start as a single file per kind; promote a kind to its own subdirectory only once it grows multiple files. Don't create empty or single-file directories ahead of need.
- **No flat directories**: a directory holding more than 5 implementation files at one level must be split into named subdirectories by responsibility. Split sooner than 5 if the directory's name stops predicting what's inside it.
- **Top-level partitions are boundaries, not dumping grounds**: a partition such as `frontend/` / `backend/` / `services/<name>/` gets the same discipline applied inside it — never implementation files sitting directly under the partition root.
- **One name for the shared bucket**: name it `common/` — never `shared` / `commons` / `util` / `utils` / `lib` / `misc`. Promote code into it only once two or more domains use it; don't create it ahead of need. Split its contents by what they do (`common/logging/`, `common/errors/`), never into a generic `common/utils/` or `common/helpers/`. Where the language reserves a directory (e.g. Go's `internal/`), nest `common/` under it.
- **Keep the repo root and each partition root clean**: only README/LICENSE, files a tool requires at that root (`package.json`, `Cargo.toml`, `Makefile`, `pyproject.toml`, CI config, dotfiles), and top-level directories belong there. Never place implementation files, generated output, static assets, scratch files, or data dumps at a root.
- **Generated output goes in a dedicated, gitignored directory** (`dist/`, `build/`, `target/`, `docs/_build/`, etc.) — never next to source or at a root.
- **Record the shape in `docs/architecture.md`** and keep it in sync: before creating a new directory, check it for where things go; if it isn't covered, add a line there in the same change before creating the directory.
