---
paths:
  - "**/*.java"
---

# Java Rules

## Type Safety

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Java.

- Use generics everywhere. Raw types (e.g., `List` instead of `List<String>`) are forbidden.
- `var` is allowed for local variables only when the inferred type is obvious from the right-hand side. Do not use `var` for fields or method signatures.
- Annotate nullable and non-null references with `@Nullable` / `@NonNull` (JSR-305 or JetBrains). Enable null-analysis in your IDE and static analysis tool.
- Never use `instanceof` without a pattern-variable binding in Java 16+: `if (o instanceof Foo f)`.

## Null Safety

- Return `Optional<T>` instead of `null` from methods when absence is a meaningful domain state. Do not use `Optional` for fields or method parameters.
- Never pass or return `null` from a public API without explicit `@Nullable` annotation.
- Do not call `Optional.get()` without first checking `isPresent()` — use `orElse`, `orElseGet`, `orElseThrow`, or `ifPresent` instead.

## Error Handling

- Catch the most specific exception class possible. Catching `Exception` or `Throwable` is forbidden in application logic.
- Never swallow exceptions silently. Every caught exception must be logged, re-thrown, or wrapped in a domain exception with a meaningful message.
- Release resources with `try`-with-resources. Never close resources manually in `finally` blocks when `AutoCloseable` is available.
- Define domain exceptions as meaningful subclasses of `RuntimeException` (preferred) or checked exceptions when the caller must handle them. Include the original cause via `initCause` / the `cause` constructor parameter.

## Immutability and Safe Patterns

- Declare fields `final` wherever possible. Use `record` for pure data carriers.
- Use immutable collections from `List.of(...)`, `Map.of(...)`, `Set.of(...)`. Do not defensively copy when returning these.
- Never expose mutable fields directly. Return unmodifiable views or copies if the internal state must stay private.
- Avoid `static` mutable state. If shared state is unavoidable, guard it with explicit concurrency primitives.

## Data Representation

- Represent fixed sets of values with `enum`, not integer constants or string literals.
- Model sum types (discriminated unions) with `sealed` classes / interfaces plus `case` classes or records. Use `switch` expressions with pattern matching for exhaustive handling.
- Prefer `record` over `@Data` / Lombok for simple value objects in new code. If the project already uses Lombok, apply it consistently.
- Replace `java.util.Date`, `java.util.Calendar`, and `java.sql.Date` with `java.time` types (`LocalDate`, `Instant`, `ZonedDateTime`, etc.).

## Modern Java Idioms

- Use `switch` expressions (arrow form) in preference to `switch` statements.
- Apply Stream API for transformations over collections; keep pipelines readable — split long chains across lines.
- Use text blocks (`"""..."""`) for multi-line strings instead of concatenation.
- Target Java 21 LTS or later for new projects; document the minimum JDK version in `pom.xml` / `build.gradle`.

## Code Style and Tooling

- Conform to the Google Java Style Guide. Enforce with `google-java-format` via a Spotless or similar Gradle/Maven plugin; formatting is automatic, never manual.
- Run Checkstyle and Error Prone in CI. Zero violations is the bar.
- Disable rules with inline suppression comments only when necessary, and always explain why.

## Logging

- The rules on prohibiting debug `System.out.println` calls, log-level usage, debug mode, file output, and rotation follow the Programming › Logging section of `CLAUDE.md`.
- Use SLF4J as the logging facade and Logback as the backend. Never use `java.util.logging` or `Log4j` directly in new code.
- Always use parameterized log messages: `logger.debug("value={}", val)`. String concatenation inside log calls is forbidden.
- Obtain loggers as `private static final Logger logger = LoggerFactory.getLogger(MyClass.class)`.

## Documentation

- Every public class, interface, enum, and method must have a Javadoc comment covering what it does, `@param`, `@return`, and `@throws`.
- Keep Javadoc in sync with the implementation. Stale or misleading docs are a bug.
- Run `javadoc` (or `./gradlew javadoc`) in CI and leave no warnings for public API.

## Dependency Management

- Use Maven or Gradle (choose one per project). Commit `gradle/libs.versions.toml` or `pom.xml` with pinned versions.
- Lock transitive dependencies: use Gradle's dependency locking (`dependencyLocking`) or Maven's `versions:lock-snapshots`. Commit the lock file.
- Audit dependencies with `./gradlew dependencyCheckAnalyze` (OWASP) or equivalent. Resolve critical CVEs before merging.
