---
---

# Coding Principles

## 0. Foundation

Build on pure functions, immutable data, and composition (functional core / imperative shell), and apply SOLID on top of that as a design discipline. **FP is the vocabulary of implementation; SOLID is the design of boundaries** — they do not conflict. When in doubt, choose the option that is *easier to test* and *has fewer side effects*.

Priority on conflict: **correctness > testability > readability > simplicity > abstraction**. Prefer duplication over premature abstraction.

---

## 1. Pure Functions and Side-Effect Isolation (FP foundation)

- **Default to pure functions.** Same input → same output, with no reading or writing of external state.
- **Immutability:** never mutate values; return new ones. Destructive assignment and in-place mutation of arguments are forbidden. If a variable needs reassignment, question whether it truly does.
- **Isolate side effects at the boundary.** Push I/O, network, randomness, current time, and global state out of the core (pure logic) and concentrate them in the outermost layer (shell).
- When a side effect is needed, **inject it as a dependency** and receive it as an argument. Do not hide dependencies inside a function.

```text
NG: function applyTax(cart){ cart.total *= 1.1; return cart }  // mutates the argument
OK: const applyTax = (cart, rate) => ({ ...cart, total: cart.total * rate })
```

---

## 2. No Magic Numbers / Magic Strings

- If a literal carries meaning, make it a **named constant**. Express the unit, meaning, and origin through the name, not a comment.
- Extract to a constant once the same value appears in two or more places. Move environment-dependent values into config.
- Exceptions: self-evident `0` / `1` / empty string, fixed values in tests, and anything whose meaning is obvious from context.

```text
NG: if (status === 3) ...            / setTimeout(fn, 86400000)
OK: if (status === Status.Closed) ... / setTimeout(fn, ONE_DAY_MS)
```

---

## 3. Apply SOLID in FP Terms

| Principle | How it works in FP |
|---|---|
| **S** Single Responsibility | One responsibility per function. Keep them small; don't mix data transformation with I/O. |
| **O** Open/Closed | Extend via higher-order functions, composition, and data-driven design rather than rewriting existing code. |
| **L** Liskov Substitution | Honor the contract of types and function signatures. Keep types narrow; don't let them lie. |
| **I** Interface Segregation | A function takes only the arguments it needs. Don't pass a whole large object wholesale. |
| **D** Dependency Inversion | Depend on abstractions (function types / interfaces), not concretions. Inject side effects (= imperative shell). |

---

## 4. Test-Driven Development (TDD)

- Run **Red → Green → Refactor** in small cycles. Write a failing test first, make it pass with the minimal implementation, then clean up.
- Tests verify **behavior**, not internal structure. Don't couple them to implementation details.
- Write with **AAA (Arrange / Act / Assert)**, one concern per test. Tests must be fast, independent, and reproducible.
- Pure functions are testable as-is; side effects are isolated via injected mocks ⇒ §1 is what makes testing easy.
- For bug fixes, **write a reproducing test first**, then fix.

---

## 5. Write Modern Code

- Follow the language's **latest official style guide and standard idioms**; don't use deprecated or legacy APIs.
- Assume a **formatter / linter / type checker** and keep the code in a state where they all pass. Don't format by hand.
- Default to immutable bindings (`const`, etc.); keep mutability minimal. Prefer declarative constructs (map/filter/reduce) over old-style loops, as long as readability doesn't suffer.
- Follow the language's current async conventions (async/await, etc.). Don't create callback hell.

---

## 6. Supporting Principles

- **Naming:** choose intention-revealing names. Let the name speak rather than patching it with a comment.
- **Early return / guard clauses** to keep nesting shallow.
- **Treat errors as values** where possible (Result / Either, etc.). Reserve exceptions for genuinely exceptional events. Respect the language's conventions.
- **Inline comments explain "why."** Don't restate the "what" that the code already shows verbatim (API descriptions and intent comments are made mandatory in §8).
- **YAGNI:** don't generalize for needs you don't have yet. Apply **DRY** to duplication of *meaning*, and don't force coincidental matches together.

---

## 7. Type Discipline — Never Leave Types Ambiguous

This principle applies to **all languages**, statically and dynamically typed alike. For languages where full static enforcement is impractical, apply it best-effort; the target is a **type-checked codebase**, not merely an annotated one.

- **Types are machine-verifiable contracts; ambiguity is a bug.** A value whose type does not precisely constrain what it can be is a lie the compiler cannot catch. Treat "what can this value be?" having no exact answer as a defect.
- **Always make types explicit and as narrow as the domain allows.** Avoid wide-escape types (`any`, `Object`, raw/unparameterized collections, untyped dicts/hashes) and relying on inference at public API boundaries. Prefer `unknown` over `any` when a type must remain open.
- **Apply to dynamically typed languages via gradual typing tools.** Use language-native annotation mechanisms (Python type hints, TypeScript for JS, RBS/Sorbet for Ruby) and run the corresponding static checker in CI with zero errors as the bar. Annotation alone is insufficient — the checker must pass.
- **Escape hatches are a last resort, never a default.** `any` / `Any` / `asInstanceOf` / raw types / `Box<dyn Any>` are forbidden in principle. When a dynamic boundary (serialization, reflection, FFI) makes them unavoidable, confine them to the smallest possible scope and document why with a comment.
- **Make illegal states unrepresentable.** Domain values that share a base representation must be distinguished with `newtype` wrappers, opaque types, or branded types (e.g., `UserId ≠ Long`). Fixed choices use enum / sum types; optionality uses `Option`/`Maybe`/`T | null`; failures use `Result`/`Either` — not sentinel values or nullable primitives.
- **Public signatures never rely on inference.** Public functions, methods, and top-level bindings must carry explicit parameter types and return types even when inference could deduce them. Inference is for local bindings only.
- **Best-effort is not zero-effort.** Where strict typing is impractical (legacy assets, inherently dynamic boundaries), match the file's established conventions, flag gaps explicitly, and tighten coverage incrementally — never abandon the goal.

Language-specific enforcement (forbidden constructs, required tooling, CI commands) is defined in each language file's **Type Safety** or **Type Annotations** section.

---

## 8. Documentation (mandatory)

- **Documentation on classes and functions is mandatory.** Use the language's standard format (Python: docstring / PEP 257; JS/TS: JSDoc / TSDoc; Java: Javadoc; Go: doc comment; Rust: `///`; etc.).
- Content: **what it does**, the meaning of parameters and return value, and (where applicable) **side effects, exceptions thrown, and preconditions**. Write the **contract** the caller needs to read, not a line-by-line restatement of the implementation.
- Strictly required for public classes and functions. Even a small private helper gets a one-line note if its intent isn't self-evident.
- **Comment variables and constants with what they are for** too. Capture intent, unit, constraints, and "why this value." Express what a name can carry through the name (§2); use a comment for the background a name can't.
- **Keep documentation in sync with the code.** When a signature or behavior changes, update the description; never leave stale docs in place.

```text
OK (TS):
/** Returns the tax-included price. Does not modify the original cart (pure function).
 *  @param cart  the target cart   @param rate  tax rate (e.g. 0.1 = 10%)   @returns a new cart */
const applyTax = (cart, rate) => ({ ...cart, total: cart.total * rate });

// Retry ceiling. Set to 3 to stay within the external API's rate limit (60/min).
const MAX_RETRY = 3;
```

---

## 9. Application Policy

- When editing existing code, **prioritize that file's established conventions** (formatter settings, naming, patterns). If they conflict with these principles, say so first, then either match them or confirm with the user.
- When you notice existing code that violates these principles, don't perform a large unrequested refactor beyond the task's scope; **point it out and offer a minimal fix** instead.

---

## 10. Exception Handling — Be Specific, Leave No Gap

- **Catch the narrowest exception type possible.** `except Exception`, `catch (Exception e)`, `rescue StandardError`, etc. are forbidden as a default catch-all. Name the exact condition you expect to handle.
- **Every caught exception must be handled meaningfully.** Log it, re-raise it, convert it to a domain error, or surface it to the caller — silently swallowing (`except ...: pass`, empty `catch {}`) is forbidden.
- **Leave no gap.** Identify every path that can throw or fail, and decide explicitly what happens in each case. An unhandled path is a latent bug.
- **Use domain-specific exception types.** Wrap low-level errors (I/O, network, parse failure) in exceptions whose name expresses the business meaning. Callers should not need to know the underlying library.
- **Let truly unexpected exceptions propagate.** Do not catch errors you cannot handle at the current layer; let them surface to a boundary (top-level handler, middleware, main) that can log and decide.

```text
NG: except Exception: pass           # swallowed silently
NG: catch (Exception e) {}           # same in Java/Kotlin
OK: except (ValueError, KeyError) as e: raise DomainError("invalid config") from e
```

---

## 11. Environment Independence — Write Platform-Agnostic Code

- **Assume the code runs on Linux, macOS, and Windows unless the target is explicitly single-platform.** Never rely on OS-specific behavior without an explicit guard.
- **Never hardcode path separators.** Use the language's path library (`pathlib.Path`, `path.join`, `std::path::Path`, etc.) instead of string concatenation with `/` or `\`.
- **Never assume a fixed home directory, temp directory, or file system layout.** Use the standard API (`Path.home()`, `tempfile.mkdtemp()`, `os.environ["HOME"]`) and test with both absolute and relative inputs.
- **Avoid shell-isms.** Shell commands, shebang lines, and environment variables whose names or values differ by OS must be guarded or abstracted. Prefer language-native APIs over subprocess/shell calls.
- **Test platform-sensitive paths in CI** across at least the set of platforms the project targets.

```text
NG: open("C:\\Users\\me\\data.txt")
NG: path = base + "/" + name
OK: pathlib.Path.home() / "data.txt"
OK: pathlib.Path(base) / name
```

---

## 12. Impact Analysis — Verify the Full Blast Radius Before Changing

- **Before editing any function, type, or module, identify every direct caller.** Use search tools (grep, IDE references, `git log -S`) — don't rely on memory.
- **Trace transitively.** A change to a shared utility or base class propagates to every consumer of its consumers. Follow the chain until you reach a stable boundary (entry point, public API, external contract).
- **Check implicit dependencies.** Serialized data formats, database schemas, environment variables, configuration keys, and wire protocols are contracts even when there is no type-level link. Changing them silently breaks consumers.
- **Assess the blast radius before committing to an approach.** If the impact is larger than expected, surface that to the user and agree on scope before proceeding.
- **Leave a note when impact is deliberately deferred.** If a known affected site is not updated in the current change, call it out explicitly (comment, PR description, or follow-up task) rather than leaving it as an invisible debt.

---

## 13. Modularization — Organize Code into Cohesive, Discoverable Units

- **One responsibility per module/file.** A file that does "everything" is a maintenance liability. Split along clear conceptual boundaries (domain, layer, feature).
- **Never inline logic that belongs in a named module.** If a block of code has a name-worthy purpose, extract it to its own function, class, or file — don't leave it as an anonymous blob in the middle of a larger routine.
- **Mirror structure to domain, not to file type.** Prefer `feature/auth/{model,service,handler}.py` over `models/auth.py + services/auth.py` unless the framework mandates otherwise. Group by what changes together.
- **Keep directory depth proportional to project size.** Two or three levels are usually enough; deeper nesting signals over-fragmentation. A flat module list that has grown unmanageable is a sign to introduce one layer of grouping, not five.
- **Explicit public interface.** Expose only what callers need. Mark internal helpers as private (`_prefix`, `private`, `internal`) and declare public exports explicitly (`__all__`, `pub`, `export`). The boundary between public API and implementation detail must be legible.
- **Avoid circular imports/dependencies.** If module A depends on B and B depends on A, extract the shared concern into a third module C that neither imports the other.
