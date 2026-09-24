---
name: amend
description: Amend part of an existing design document (docs/design/<slug>.md) together with the open TODO tasks it affects, in one pass. Use when execute-task stopped on a design hole and left a hole record in HANDOFF.md, or when the user directs a small revision or a single added task. Never creates a new plan row; hands back to the elaborate skill when the design's goal or scope must change.
---

# Amend a design and its open tasks

Read `~/.claude/commands/amend.md` completely and follow it as the canonical contract shared with Claude Code. Also read the "変更の三段分類" section of `~/.claude/templates/BLUEPRINT.md` §6 and `~/.claude/templates/model-routing.md`, and apply the Codex column of its partial-amendment role. If the active profile is known to be below that role, report that the amendment has not started and recommend rerunning under the required profile.

Apply these Codex translations:

- Treat the task ID supplied with `$amend` as the command's `$ARGUMENTS`. With a task ID, the hole record under "仕掛かり中" in `HANDOFF.md` is the primary source; do not reconstruct the situation from the whole design document or from chat history. Without a task ID, the primary source is the user's instruction in this conversation, or a user-decision row that a pending-item collection wrote into `docs/decisions.md`; take that row verbatim and do not widen the decision.
- Keep the reading scope as narrow as the canonical command defines. Needing to reread the whole design is itself evidence that the change exceeds a partial amendment.
- Run exactly one `proposal_reviewer` custom subagent before presenting the amendment. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count and give it a self-contained prompt; a full-history fork cannot select a custom role. If custom-role selection is unavailable, use a fresh-context read-only subagent and include the proposal-reviewer contract in its prompt. It must challenge whether any completion-condition change merely relaxes the standard to fit the implementation, whether each added task is necessary, and whether the revised task set still reaches the goal of the `plan.md` phase that the design's `全体構想` line points at (read and hand over only that phase's text and the goal at the top of `plan.md`, verbatim).
- Present the whole amendment (design-section changes, rewritten open tasks with before/after, added tasks, abolished tasks, and any relaxation) once through `request_user_input` and land only what the user approved.
- When the amendment moves the line between what the design fixes and what it leaves to the executor, update the design's `実行者の裁量と停止条件` subsection and the plan's `共通の前提` in `TODO.md` together. Apply the canonical splitting rule to any added task.
- Rewrite open (`[ ]`) tasks in place instead of stacking compensating tasks. Never change a `T<n>`, a `#<n>-<m>` index, a completed (`[x]`) or abolished (`[-]`) entry, or the archive. Honor the canonical limit of three added tasks per run and the origin tag on every added task.
- A plan row stays `[ ]` while its design still lists a `段階 <n>: 未分解` line, even when every task under it is done or abolished. When the amendment changes the stages in the approach section, update those lines in the design's `タスク分解` section to match.
- If the project's `TODO.md` header comment does not define in-place revision of open tasks or the `[-]` state, do not land the amendment; report that the project must first be migrated by the procedure in `BLUEPRINT.md` §6.
- Use `.codex/archive/` and `.codex/rules/growing-docs.md` in Codex-native projects. Continue using `.claude/...` paths in an existing Claude project unless the user has approved a project-level migration. Preserve the existing TODO table column layout, including a `難` column where the file already has one.
- Do not commit unless the canonical workflow and the user's authority permit it. Use the `amend` commit prefix the canonical command defines.

The outcome is a small, approved correction that lets the interrupted `T<n>` resume — not a new plan, a new design document, or a growing pile of tasks.
