---
name: breakdown
description: Break a design document (docs/design/<slug>.md, produced by the elaborate skill) into executable TODO state with task IDs and verifiable completion conditions. Takes only the design document as input.
---

# Break a design document into tasks

Read `~/.claude/commands/breakdown.md`, `~/.claude/templates/BLUEPRINT.md`, and only the skeleton templates that the command calls for. Those files are the canonical workflow shared with Claude Code.

Apply these Codex translations:

- Before writing durable artifacts, form your own interpretation and then ask the `advisor` custom subagent to challenge the task granularity and the verifiability of completion conditions. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count and give it a self-contained prompt; a full-history fork cannot select a custom role. If custom-role selection is unavailable, use a fresh-context read-only subagent and include the advisor contract in its prompt.
- The design document is the only primary source. If it lacks what a task needs, ask through `request_user_input` or hand back to the elaborate skill; do not invent missing rationale.
- Run only for plan-level planning (a new plan row in `TODO.md`). Do not run for a plan whose outcome is verified by an existing `T<n>` completion condition; the granularity rule in `TODO.md` §0 is canonical.
- Preserve existing `HANDOFF.md`, `docs/decisions.md`, TODO format detection, task-ID rules, table column layout, line budgets, and idempotency exactly as the canonical command defines them.
- Use `.codex/archive/` and `.codex/rules/growing-docs.md` in Codex-native projects. Continue using `.claude/...` paths in an existing Claude project unless the user has approved a project-level migration.
- Do not commit unless the canonical workflow and the user's authority permit it.

The outcome is not merely a task list: another session must be able to execute each `T<n>` from the landed files alone, without reconstructing omitted decisions from chat history.
