---
name: execute-task
description: Execute one existing numbered T task from TODO.md through implementation, verification, project-state updates, and a task-scoped commit. Use when the user invokes $execute-task with a task ID or asks to execute a specific existing TODO task without redesigning it.
---

# Execute one defined task

Read `~/.claude/commands/execute-task.md` completely and follow it as the canonical execution contract shared with Claude Code.

Also read `~/.claude/templates/model-routing.md` and apply its Codex column. Its cross-system pairings are workflow roles, not claims of general capability equivalence.

Apply these Codex translations:

- Treat the task ID supplied with `$execute-task` as the command's `$ARGUMENTS`. Accept exactly one `T<n>`.
- In Codex-native projects, use `AGENTS.md`, `.codex/rules/`, and `.codex/archive/`; retain existing Claude-native paths in projects that have not migrated. Project-local instructions remain authoritative.
- Read the plan section's `共通の前提` and the design items it names before implementing, so that you know what the design fixes and what it leaves to your discretion. When you decide something the design left to your discretion and later tasks or other artifacts depend on it, record it as one line in `docs/decisions.md` with this task's ID; do not record purely local choices. When a fixed contract cannot be met, do not change it; stop through the hole-record path.
- Apply the canonical pre-start gate: extract the `要確認` items in `HANDOFF.md` whose collection point is this task and the `docs/decisions.md` rows whose task-ID column names it, with a boundary-safe match. Ask gate items through `request_user_input` before implementing, record the decision in `docs/decisions.md`, and remove the item. Withdraw a question only when it is measurably already settled; never settle it yourself. If no answer can be obtained, stop this task only and report.
- When the completed task was the last open task of its plan and the design still lists a `未分解` stage, keep the plan row `[ ]` and set the next action in `HANDOFF.md` to the `breakdown` skill for that design. Do not break the next stage down yourself.
- Use Codex commentary only when the canonical command calls for user-visible progress or a non-trivial implementation decision; do not turn routine execution into a plan-mode transcript.
- Do not create a Codex goal automatically. A goal is an optional host capability for cases where the user separately wants to prevent premature termination during a long-running task.
- Do not invoke the `amend`, `elaborate`, `breakdown`, or `follow-up` skills unless the canonical command and the active project's rules explicitly require them. If the work crosses the task's existing design boundary, stop, write the hole record the canonical command defines into `HANDOFF.md`, and report the required next workflow (`amend` for a partial amendment, `elaborate` only when the design's goal or scope must change) rather than starting it. Never edit a completion-condition block and never mark a task `[-]`; the only in-place fix allowed during execution is a reference (path, file name, identifier) that the repository itself proves wrong.
- Do not force the standard model through work it cannot complete with adequate confidence. If ordinary investigation cannot narrow a failure, implementation complexity exceeds confident local execution, or completion evidence remains insufficient, leave the T incomplete and recommend the next Codex implementation tier from `model-routing.md`; use its final implementation tier only when the work remains especially complex. If code materially disagrees with TODO/design, the T requires a much broader change, or a non-trivial design or plan update is needed, stop and recommend the partial-amendment or planning route from that document instead of continuing up the implementation-model ladder.
- Recommend a model change only when a routing condition is observed. State the evidence and the next profile; do not ask the user to choose a model during normal execution. A skill does not itself change the host model, so never claim that escalation already occurred.
- For a required high-risk review, use a fresh `diff_reviewer` custom subagent when available, with a bounded or fresh context and a read-only contract. Verify its claims against primary evidence before changing the worktree.
- Respect the active permission model for commits and all external mutations. This skill does not itself grant authority to commit, push, publish, deploy, or change external state.

The outcome is a completed, verified, and properly recorded existing task—not a new plan or redesign.
