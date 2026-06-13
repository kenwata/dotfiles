---
---

# Testing Rules

The following rules apply to all programming languages and projects.

## Core Policy

- Following the Programming rules in `CLAUDE.md`, write a test for every function you create.
- Tests verify **behavior (inputs, outputs, and side effects)**, not implementation details.
- Write test code with the same attention to readability and maintainability as production code.

## Types of Tests

Use the following three types according to their purpose.

- **Unit Test**: Verifies the behavior of a single function or class. Replace dependencies with mocks/stubs.
- **Integration Test**: Verifies the behavior of multiple modules working together.
- **End-to-End (E2E) Test**: Verifies the behavior of the entire system from the user's perspective.

## Test Structure

- Structure tests with the **AAA pattern** (Arrange / Act / Assert).
  - Arrange: set up the subject under test and input data
  - Act: execute the subject under test
  - Assert: verify the result
- Separate each section with blank lines as needed to make the boundaries clear.

## One Concern per Test

- As a rule, each test asserts only one **concern**.
- Do not pack multiple unrelated behaviors into a single test.

## Test Independence

- Tests must not depend on each other. The result must be the same regardless of execution order.
- Always reset state before and after each test so no side effects leak to other tests.
- Avoid depending on global variables or shared state.

## Determinism

- Tests must produce the same result no matter how many times they are run (idempotency).
- Replace non-deterministic elements — dates/times, random numbers, external APIs — with mocks/stubs.
- Absorb dependencies on the filesystem and environment variables with test fixtures or substitutions.

## Naming

- Test names should make clear: what is being tested, what the condition is, and what the expected result is.
- Examples: `returns_square_root_given_positive_number`, `returns_empty_given_empty_list`, `throws_exception_when_argument_is_null`
- Name test files to correspond to the target module (e.g., `utils.py` → `test_utils.py`).

## Mocks and Stubs

- Replace external I/O (network, filesystem, clock) with mocks/stubs in unit tests.
- Keep mocks to the minimum necessary. Excessive mocking creates coupling to implementation details and hinders refactoring.
- Verify mock interactions (whether called, with what arguments) only when that interaction itself is the concern of the test.

## Boundary Values and Error Cases

- Write tests not only for the happy path but also for boundary values, empty values, null/undefined, maximum values, minimum values, and invalid inputs.
- When an exception or error is expected, also verify the error type and message.

## Test Data

- Declare test data explicitly inside the test code; avoid implicit dependencies on external files.
- Consolidate shared test data into fixtures or factory functions to eliminate duplication.
- Never use production data in tests.

## Coverage

- Target at least 80% unit-test coverage for new code as a rule.
- Do not write meaningless tests whose only purpose is to raise the coverage number.
- Low coverage in an area may indicate a design that is hard to test; consider refactoring.

## Test Performance

- Keep unit tests fast. If I/O, sleeps, or heavy computation are required, use mocks or move the test to the integration layer.
- Be mindful of CI execution time; tag slow tests with a category (tag/marker) so they can be run separately.

## Test File Layout

- Place test files in locations that correspond to the source code under test, following the conventions of the language and framework.
- Collect test-only utilities and helpers inside the test directory and do not mix them with production code.
