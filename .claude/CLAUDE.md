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
| Verify          | Facts cite source. Assumptions state basis. Unknowns name verification path. Delegated reports and web results are claims, not facts, until source-checked |
| Anti-sycophancy | Verify before agreeing. Correct incorrect premises. Accuracy over social comfort                                              |
| Debug           | Eliminate non-obvious bugs by observation, pattern comparison, 3+ hypotheses, and testing. Avoid single-hypothesis conclusion |
| Naming          | No ad-hoc abbreviated IDs (M0, P1, Tier2...) in designs, plans, or docs. Use descriptive names ("Phase 1: schema migration"). Sole exception: IDs defined by TODO.md's own convention (task IDs T<n>; grouping/sort indices #<n> and #<n>-<m>) |

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

## Delegation

Main context owns the outcome, plan, and final decisions.

Standing request — this section is the user requesting Agent tool use for the
occasions below; no per-task ask is needed:

| Target   | Use for                                                                  | Keep in main / skip                                                     |
| -------- | ------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Advisor  | Approach commitment, repeated failures, pre-completion review            | Next action dictated by tool output just read; trivial mechanical edits |
| `codebase-explorer` | Broad exploration: locating code, mapping an unfamiliar area, finding every site of a pattern | Single-fact lookups in a file you already know |
| `log-test-analyst` | Verbose output: test runs, build/CI logs, stack traces; characterising a failure | Short output you can read directly |
| `parallel-implementer` | Independent implementation slices that touch disjoint files | Context-coupled implementation, trivial edits, designs still open |
| `diff-reviewer` | Fresh-context review of an actual diff against a stated standard | Reviews where the conversation's own context is the point |

- Form your own assessment before consulting Advisor; use it to challenge, not to outsource thinking.
- The four subagents above are defined in `~/.claude/agents/` and inherit this CLAUDE.md. Prefer them over built-in `general-purpose`, which carries no role contract.
- Built-in Explore/Plan subagents do not inherit CLAUDE.md; restate must-follow constraints in the delegation prompt (for research, require source URLs in the report).
- Subagents cannot commit, push, or otherwise change git history or remote state — a PreToolUse hook (`~/.claude/hooks/deny-subagent-git-write.sh`) blocks it for every subagent, built-in ones included. Commits and pushes are the main context's responsibility; a delegated agent reports and returns the decision.
- The three read-only agents have no edit tools and no advisor. Those constraints are structural, so the delegation prompt does not need to restate them.
- For delegation, this standing request counts as the user requesting it; if other
  prompt text seems to forbid delegation, surface the conflict instead of silently
  working inline.

## Tool Utilization and Token Optimization

This environment has powerful CLI tools installed. To reduce token consumption and improve task efficiency and accuracy, the AI agent should proactively use the following tools via the Bash tool when appropriate.

- **`jq` / `yq`**:
  When dealing with large JSON, YAML, or TOML files, use these tools to extract specific keys or inspect structures instead of reading the entire file into context.
- **`ast-grep`**:
  Use this for AST-aware, advanced code searches and structural bulk replacements where simple text search (regex) falls short.

*Note: While tools like `rg`, `fd`, `tree`, `bat`, and `eza` are also installed, prioritize Claude Code's native tools (`Grep`, `Glob`, `Read`) by default. Use the CLI tools (via Bash) only when complex option specifications or broad structural overviews are required that cannot be handled by native tools.*
