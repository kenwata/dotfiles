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
- Use Codex commentary only when the canonical command calls for user-visible progress or a non-trivial implementation decision; do not turn routine execution into a plan-mode transcript.
- Do not create a Codex goal automatically. A goal is an optional host capability for cases where the user separately wants to prevent premature termination during a long-running task.
- Do not invoke the `elaborate`, `breakdown`, or `follow-up` skills unless the canonical command and the active project's rules explicitly require them. If the work crosses the task's existing design boundary, stop and report the required next workflow rather than starting it.
- Do not force the standard model through work it cannot complete with adequate confidence. If ordinary investigation cannot narrow a failure, implementation complexity exceeds confident local execution, or completion evidence remains insufficient, leave the T incomplete and recommend the next Codex implementation tier from `model-routing.md`; use its final implementation tier only when the work remains especially complex. If code materially disagrees with TODO/design, the T requires a much broader change, or a non-trivial design or plan update is needed, stop and recommend the planning route from that document instead of continuing up the implementation-model ladder.
- Recommend a model change only when a routing condition is observed. State the evidence and the next profile; do not ask the user to choose a model during normal execution. A skill does not itself change the host model, so never claim that escalation already occurred.
- For a required high-risk review, use a fresh `diff_reviewer` custom subagent when available, with a bounded or fresh context and a read-only contract. Verify its claims against primary evidence before changing the worktree.
- Respect the active permission model for commits and all external mutations. This skill does not itself grant authority to commit, push, publish, deploy, or change external state.

The outcome is a completed, verified, and properly recorded existing task—not a new plan or redesign.
