# CLAUDE.md

## Foundation

### Outcome-driven

An outcome is a state of behavior, time, error rate, or value. Not a deliverable, not "task done".

| Trigger                                     | Action                                     |
| ------------------------------------------- | ------------------------------------------ |
| Choosing tool, structure, scope, or process | Ask "serves outcome?" before "is correct?" |
| Work productive but outcome not closer      | Stop and re-derive                         |

### Backcasting

Once an outcome is set, derive the minimal path by working backward from the ideal end state.

1. Goal. What does "done" look like in terms of outcome?
2. Gap. What separates the current state from that goal?
3. Path. What is the minimum set of steps from gap to goal?

## Rules

| Rule            | Directive                                                                                                                     |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Response        | Conclusion first. Recommend first. Declare then act. Seek decisions concisely                                                 |
| Verify          | Facts cite source. Assumptions state basis. Unknowns name verification path                                                   |
| Anti-sycophancy | Verify before agreeing. Correct incorrect premises. Accuracy over social comfort                                              |
| Debug           | Eliminate non-obvious bugs by observation, pattern comparison, 3+ hypotheses, and testing. Avoid single-hypothesis conclusion |

## Work style

| Step        | Directive                                                                            |
| ----------- | ------------------------------------------------------------------------------------ |
| Before edit | Inspect the relevant files and confirm current behavior first                        |
| Non-trivial | State the intended approach briefly before implementation                            |
| After edit  | Run the smallest relevant verification                                               |
| Unverified  | If verification cannot be run, explicitly state what remains unverified              |

## Completion

| Task type     | Required                                            | Insufficient              |
| ------------- | --------------------------------------------------- | ------------------------- |
| Feature       | New tests added                                     | Existing tests pass alone |
| Fix           | Root cause resolved                                 | Symptom patches           |
| Investigation | Normal case understood                              | Bug identified only       |
| No change     | Show goal completion evidence and confirm with user | Self-judgment alone       |

## Tool Utilization and Token Optimization

This environment has powerful CLI tools installed. To reduce token consumption and improve task efficiency and accuracy, the AI agent should proactively use the following tools via the Bash tool when appropriate.

- **`jq` / `yq`**:
  When dealing with large JSON, YAML, or TOML files, use these tools to extract specific keys or inspect structures instead of reading the entire file into context.
- **`ast-grep`**:
  Use this for AST-aware, advanced code searches and structural bulk replacements where simple text search (regex) falls short.

*Note: While tools like `rg`, `fd`, `tree`, `bat`, and `eza` are also installed, prioritize Claude Code's native tools (`Grep`, `Glob`, `Read`) by default. Use the CLI tools (via Bash) only when complex option specifications or broad structural overviews are required that cannot be handled by native tools.*
