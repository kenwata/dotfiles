---
---

# Coding Principles

## 0. Foundation

Build on pure functions, immutable data, and composition (functional core / imperative shell), with SOLID applied on top as the design of boundaries. When in doubt, choose the option that is *easier to test* and *has fewer side effects*.

Priority on conflict: **correctness > testability > readability > simplicity > abstraction**. Prefer duplication over premature abstraction. Performance is outside this chain (§6).

## 1. Pure Functions and Side-Effect Isolation

- Default to pure functions: same input → same output, no reading or writing of external state.
- Immutability: never mutate values or arguments — output parameters included: don't push into a passed collection or fill a passed object; return the new value and let the caller combine. Question any reassignment.
- Isolate side effects at the boundary: push I/O, network, randomness, current time, and global state out of the pure core into the outermost shell.
- Inject side effects as dependencies and receive them as arguments; never hide dependencies inside a function.

## 2. No Magic Numbers / Magic Strings

- If a literal carries meaning, make it a named constant; express unit, meaning, and origin through the name.
- Extract to a constant once the same value appears in two or more places. Move environment-dependent values into config.
- Exceptions: self-evident `0` / `1` / empty string, fixed values in tests, and anything whose meaning is obvious from context.

## 3. SOLID in FP Terms

One responsibility per function. Size test: a function that reads as three or more work paragraphs (§14; guard clauses and the closing `return` don't count) has three or more responsibilities — extract until each is one paragraph or a sequence of calls whose names tell the story, and extract only what you can name honestly (if the only name is `helper` / `processX2`, the cut is wrong, not the size; §13). More than five parameters or a boolean flag argument means two functions or a parameter object. Numeric gates (statements, branches, parameters, complexity) live in each language file's linter config; a function that trips one is split, never pragma-silenced. Don't mix data transformation with I/O; extend via higher-order functions, composition, and data-driven design rather than rewriting; honor the contract of types and signatures, keeping types narrow; take only the arguments you need; depend on abstractions and inject side effects.

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
- YAGNI: don't generalize for needs you don't have yet, and delete helpers and exports in the change that orphans them ("for later" is not a caller). Apply DRY to duplication of *meaning*; don't force coincidental matches together.
- Performance: write the readable form first; optimize only what a measurement names, in this order — algorithm, I/O and round trips, allocation, micro-optimization. Isolate the optimized section behind a plain interface, keep the naive version as a test oracle, and record the measured gain in the comment; an optimization without a number is a readability loss.
- Logging: diagnostics and progress go through the language's logger, never `print` / `console.log` — `DEBUG` internals, `INFO` user-visible milestones, `WARNING` recoverable oddities, `ERROR` failures; level comes from the environment (`LOG_LEVEL` / `DEBUG`), never hard-coded; file output rotates. A command's result output (what it exists to emit) is the one direct stdout write, in the entry module only.

## 7. Type Discipline — Never Leave Types Ambiguous

Applies to **all languages**, statically and dynamically typed alike. Where full static enforcement is impractical, apply it best-effort; the target is a **type-checked codebase**, not merely an annotated one.

- Types are machine-verifiable contracts. Treat a value whose type does not precisely constrain what it can be as a defect.
- Make types explicit and as narrow as the domain allows. Avoid wide-escape types (`any`, `Object`, raw/unparameterized collections, untyped dicts/hashes) and inference at public API boundaries. Prefer `unknown` over `any` when a type must remain open. Parse external data (JSON, CLI args, env, DB rows) into a typed domain structure once, at the boundary, and pass only that inward; a shape described in a comment (`// { marker, runLen, … }`) belongs in a type.
- In dynamically typed languages, use native annotation mechanisms (Python type hints, TypeScript for JS, RBS/Sorbet for Ruby) and run the corresponding static checker in CI with zero errors as the bar — annotation alone is insufficient.
- Escape hatches (`any` / `Any` / `asInstanceOf` / raw types / `Box<dyn Any>`) are a last resort, never a default. Where a dynamic boundary (serialization, reflection, FFI) makes them unavoidable, confine them to the smallest scope and document why. `object` / `unknown` / `dict[str, object]` threaded inward with a narrowing helper at every use (`_dict()`, `isinstance`) is an escape hatch under another name.
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
- A comment does not license a violation. Exceptions exist only where a rule names one (§2's listed literals, §7 dynamic boundaries, the language files' `Any` clause, `per-file-ignores`, framework-owned objects in `ignorePropertyModificationsFor`), carrying whatever comment that rule asks for. Anything else is fixed, or reported as an open deviation before "done" — never explained away.
- Before reporting a change complete, run the checks no linter can: paragraphs (§14), function size and honest names (§3), typed domain data (§7), no output-parameter mutation (§1), explained-but-unfixed violations (above). Report what was checked and what is left open.

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

- One responsibility per module/file; split along clear conceptual boundaries (domain, layer, feature). A file past ~500 lines is a split candidate; past ~1,000 it needs a reason recorded in `docs/architecture.md`. Split by responsibility, never by line count alone.
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

## 14. Paragraphs — Group by Meaning, Separate by Meaning

A blank line inside a function marks a change of topic, never a syntactic element: neither "no blank lines" nor "a blank line around every `if`/`for`" — both destroy the signal. Tests follow the same rule as Arrange / Act / Assert (`testing.md`).

- One step per paragraph: a declaration stays glued to its first use; consecutive guard clauses form one table-like paragraph; a guard and an unrelated declaration are separate paragraphs.
- The closing `return` (after the work is done) is its own paragraph; guard returns stay in the guard paragraph. Skip this in functions of about five lines.
- Inside a function body: no leading or trailing blank line.
- Formatters only cap blank-line count; placement is judgment and a mandatory item of the §9 pre-completion check.
- At module level the same rule holds for constants and definitions (imports are grouped by the language file's import sorter).
- Wanting a third paragraph, a section comment (`# --- step 2 ---`), or a bare `{ … }` block is the signal to extract a function (§3), not to add spacing.
