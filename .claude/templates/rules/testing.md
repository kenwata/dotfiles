---
---

# Testing Rules

The following rules apply to all programming languages and projects.

## Core Policy — Test-First

- **Write tests before the implementation.** Run Red → Green → Refactor in small cycles: write a failing test first, make it pass with the minimal implementation, then clean up. Every function you add gets tests — written ahead of it, never after the fact.
- For bug fixes, write a reproducing test first, then fix.
- Tests verify **behavior (inputs, outputs, and side effects)**, not implementation details or internal structure.
- Write test code with the same attention to readability and maintainability as production code.
- Use unit, integration, and E2E tests according to purpose; unit tests replace dependencies with mocks/stubs.

## Structure and Independence

- Structure tests with the **AAA pattern** (Arrange / Act / Assert), separating the sections with blank lines as needed.
- As a rule, one **concern** per test; don't pack multiple unrelated behaviors into a single test.
- Tests must not depend on each other or on execution order; reset state before and after each test so no side effects leak. Avoid global or shared state.
- Determinism: replace dates/times, random numbers, and external APIs with mocks/stubs; absorb filesystem and environment-variable dependencies with fixtures or substitutions.

## Naming

- Test names make clear what is tested, under what condition, with what expected result (e.g., `returns_empty_given_empty_list`, `throws_exception_when_argument_is_null`).
- Name test files to correspond to the target module (e.g., `utils.py` → `test_utils.py`).

## Mocks and Stubs

- Replace external I/O (network, filesystem, clock) with mocks/stubs in unit tests.
- Keep mocks to the minimum necessary; excessive mocking couples tests to implementation details and hinders refactoring.
- Verify mock interactions (whether called, with what arguments) only when that interaction itself is the concern of the test.

## Cases and Coverage

- Test not only the happy path but boundary values, empty values, null/undefined, maximum/minimum values, and invalid inputs. When an error is expected, also verify its type and message.
- Target at least 80% unit-test coverage for new code as a rule; never write meaningless tests whose only purpose is the number. Low coverage in an area may signal a hard-to-test design worth refactoring.

## Test Data, Performance, and Layout

- Declare test data explicitly inside the test code; consolidate shared data into fixtures or factory functions. Never use production data.
- Keep unit tests fast: move I/O, sleeps, and heavy computation behind mocks or into the integration layer, and tag slow tests so they can be run separately in CI.
- Place test files following the language/framework conventions, corresponding to the source under test; keep test-only helpers inside the test directory, not mixed with production code.
