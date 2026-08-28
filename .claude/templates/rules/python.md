---
paths:
  - "**/*.py"
---

# Python Rules

## Type Hints

> Cross-cutting principle: see `coding-principles.md` §7 — applies to all languages including Python.

- Always add type hints to all function and method parameters and return values.
- Also add type annotations to variable declarations when the type is not obvious.
- Using `Any` is prohibited as a rule. Use it only when the type truly cannot be determined, and include a comment explaining why.
- Prefer Python 3.10+ syntax (e.g., `X | Y`) over `Union` / `Optional`.
- Use specific type parameters for collection types: `list[str]`, `dict[str, int]`, etc.
- Run static type checking with `mypy` or `pyright` in CI and leave no errors.

## Code Style

- Conform to PEP 8.
- Run `black` or `ruff format` before every commit and in CI to enforce consistent formatting automatically.
- Lint with `ruff check`. `pyproject.toml` selects at least `E, W, F, I, N, UP, B, ANN, D, T20, PL, C90, SIM` with `pydocstyle.convention = "google"` and the default thresholds (`max-args = 5`, `max-statements = 50`, `max-branches = 12`, `max-complexity = 10`). Sanctioned escapes live in `per-file-ignores`, nowhere else: `T201` for the entry module's result output, `PLR2004, D` under `tests/**` (see Docstrings). `ANN401` is the mechanical form of the `Any` ban above; `B905` requires `zip(strict=)`; `PLR2004` flags magic numbers (magic strings are governed by `coding-principles.md` §2 and the `Enum` rule below). Size rules (§3 gates) are never `# noqa`'d — split the function.
- Order imports as: standard library → third-party → project-local. Auto-sort with `ruff` or `isort`.

## Exception Handling

- Bare `except:` is prohibited. Always specify a concrete exception class (e.g., `except ValueError:`).
- Every caught exception must be handled or re-raised. Silently swallowing exceptions is forbidden.
- Represent project-specific errors with custom exception classes that inherit from `Exception`.

## Immutability and Safe Patterns

- Mutable default arguments are prohibited. `def f(x=[]):` is NG. Use `None` as the default and initialize inside the function.
- Prefer f-strings for string formatting. Do not use the `%` operator or `str.format()`.
- Use `pathlib.Path` for path operations instead of `os.path`.

## Data Representation

- Define fixed sets of choices as `Enum` to eliminate magic strings and magic numbers.
- Represent value objects with `dataclass`, `TypedDict`, or a `pydantic` model, never plain dicts or tuples; deserialize external JSON/YAML into one at the entry point (`coding-principles.md` §7, parse at the boundary) so no function past it takes `dict[str, object]`.

## Modules and Public Interface

- Explicitly declare names exported to the outside in `__all__` to prevent unintended exposure.
- Modules that run as scripts must guard the entry point with `if __name__ == "__main__":`.

## Logging

- Debug-print prohibition, log levels, debug mode, file output, and rotation follow `coding-principles.md` §6 (Logging). The command's result output is the one `print` allowed, in the entry module only (see Code Style `per-file-ignores`).
- In Python, use the standard library `logging` module. If a third-party library (e.g., `loguru`) is used, apply it consistently across the project.
- Centralize logging configuration (handlers, formatters, levels) with `logging.config.dictConfig` or `logging.config.fileConfig`. Each module obtains its logger via `logging.getLogger(__name__)` and does not configure logging itself.
- Use `logging.handlers.TimedRotatingFileHandler` for file output with `when="D"` and `backupCount=14` as the baseline.
- Control debug-mode switching via the environment variable `DEBUG=1` or `debug: true` in the config file. When `DEBUG=1`, set the root logger level to `DEBUG`.

## Docstrings

- Write docstrings in English and follow Google style.
- Test functions are exempt from docstrings (the test name is the contract — `testing.md` Naming); `per-file-ignores` carries `D` for `tests/**`. Type hints stay mandatory in tests.
- Do not leave docstrings as a short one-line summary when the function, method, class, or data structure has a caller-visible contract.
- For functions and methods, include:
  - A concise description of what the callable does.
  - `Args:` with each parameter's meaning, expected type or shape when useful, units, and important constraints.
  - `Returns:` with the return value's meaning, type or shape, and notable empty/default cases.
  - `Raises:` for exceptions that can be propagated or intentionally raised, including `SystemExit` for CLI-style functions.
- For classes, `TypedDict`, dataclasses, and pydantic models, include `Attributes:` and describe every field that is part of the public data contract.
- For side-effecting functions, document the side effects such as file writes, stdout/stderr output, network access, process exits, or mutation of passed objects.
- Keep docstrings synchronized with the implementation whenever signatures, return shapes, errors, or side effects change.

## Documentation (Sphinx)

- Create specifications and API documentation with **Sphinx**.
- Use **Google style** as the standard docstring format and convert it with `sphinx.ext.napoleon`.
- Use `sphinx.ext.autodoc` to auto-generate API references from docstrings.
- Enable `sphinx.ext.viewcode` to add source-code links in the documentation.
- Use `sphinx-apidoc` to auto-scan the module structure and generate rst files under `docs/`.
- Run the build command (e.g., `make html`) in CI and leave no build errors.
- Exclude the generated `docs/_build/` directory from the repository by adding it to `.gitignore`.

## Dependency Management

- Create a virtual environment with `venv`, `poetry`, `uv`, or similar to isolate dependencies per project.
- Include a lock file (`poetry.lock`, `uv.lock`, or a pinned `requirements.txt`) in the repository to fix dependency versions.

## Performance Optimization

- Comprehensions and built-ins are the readable form of a loop (`coding-principles.md` §5); use NumPy/SciPy for numerical and array work. Any other optimization follows `coding-principles.md` §6 — measure first.
