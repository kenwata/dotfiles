---
name: breakdown
description: Break a design document (docs/design/<slug>.md, produced by the elaborate skill) into executable TODO state with task IDs and verifiable completion conditions. Takes only the design document as input.
---

# Break a design document into tasks

Read `~/.claude/commands/breakdown.md`, `~/.claude/templates/BLUEPRINT.md`, and only the skeleton templates that the command calls for. Those files are the canonical workflow shared with Claude Code.

Apply these Codex translations:

- Before writing durable artifacts, form your own interpretation and then ask the `proposal_reviewer` custom subagent to challenge the task granularity and the verifiability of completion conditions. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count and give it a self-contained prompt; a full-history fork cannot select a custom role. If custom-role selection is unavailable, use a fresh-context read-only subagent and include the proposal-reviewer contract in its prompt.
- The design document is the only primary source. If it lacks what a task needs, ask through `request_user_input` or hand back to the elaborate skill; do not invent missing rationale. A new design decision, scope change, uncertainty that prevents a verifiable completion condition, or architecture/contract change goes back to elaborate instead of becoming a hard task; local implementation choices, debugging, and root-cause analysis within the existing design belong to `execute-task`.
- Run only for plan-level planning: a new plan row in `TODO.md`, or re-planning of an existing plan row right after the elaborate skill changed that design's goal or scope. Only in the re-planning case may you rewrite open (`[ ]`) tasks in place, mark tasks `[-]` (abolished), and append tasks with an origin tag, all under one user approval, exactly as the canonical command defines. Do not run for a plan whose outcome is verified by an existing `T<n>` completion condition, for a single added task, or for a partial design revision — those belong to the `amend` skill. The granularity rule in `TODO.md` §0 is canonical.
- Break down only the first undecomposed stage of the design per run; leave later stages in the design document as `段階 <n>: 未分解` and create no TODO rows for them. A later-stage run on the same plan row appends only; it never rewrites or abolishes existing open tasks. While `未分解` remains in the design, the plan row stays `[ ]` even when every task under it is done.
- When the design is a side line (its `全体構想` line does not point at the section declared by `本流: §<n>` in `plan.md`), run `node ~/.claude/hooks/lib/mainline-gauge/cli.mjs <project root>` before drafting tasks and show its output. If the last line is `consecutive_side_breakdown: yes`, ask through `request_user_input` whether to proceed, narrow the side line, or return to the main line, and record the answer in `docs/decisions.md`. Do not reimplement the counting in prose; the gauge never blocks by itself.
- Preserve existing `HANDOFF.md`, `docs/decisions.md`, TODO format detection, task-ID rules, table column layout, line budgets, and idempotency exactly as the canonical command defines them. Do not assign task difficulty, a planned model, or a risk rating, and never add a `難` or risk column to a TODO that lacks one.
- Use `.codex/archive/` and `.codex/rules/growing-docs.md` in Codex-native projects. Continue using `.claude/...` paths in an existing Claude project unless the user has approved a project-level migration.
- Do not commit unless the canonical workflow and the user's authority permit it.

The outcome is not merely a task list: another session must be able to execute each `T<n>` from the landed files alone, without reconstructing omitted decisions from chat history.
