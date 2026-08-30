---
name: breakdown
description: Convert an approved plan into a durable design document and executable TODO state while preserving rationale and acceptance conditions. Use after planning is approved or when asked to persist a plan.
---

# Persist an approved plan

Read `~/.claude/commands/breakdown.md`, `~/.claude/templates/BLUEPRINT.md`, and only the skeleton templates that the command calls for. Those files are the canonical workflow shared with Claude Code.

Apply these Codex translations:

- Before writing durable artifacts, form your own interpretation and then ask the `advisor` custom subagent to challenge the goal, slug, boundaries, and task granularity. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count and give it a self-contained prompt; a full-history fork cannot select a custom role. If custom-role selection is unavailable, use a fresh-context read-only subagent and include the advisor contract in its prompt.
- Use the current conversation as the primary source. A saved plan is only a skeleton; do not invent missing rationale in a later session.
- Preserve existing `HANDOFF.md`, `docs/decisions.md`, TODO format detection, task-ID rules, line budgets, and idempotency exactly as the canonical command defines them.
- Use `.codex/archive/` and `.codex/rules/growing-docs.md` in Codex-native projects. Continue using `.claude/...` paths in an existing Claude project unless the user has approved a project-level migration.
- Do not commit unless the canonical workflow and the user's authority permit it.

The outcome is not merely two files: another session must be able to execute the work without reconstructing omitted decisions from chat history.
