---
name: follow-up
description: Reconcile all tasks and changes since the latest follow-up checkpoint against TODO, design, architecture, decisions, and handoff state. Use at project milestones or when cross-task drift is suspected, not for routine task or session completion.
---

# Reconcile plan and outcome

Read `~/.claude/commands/follow-up.md`, `~/.claude/templates/model-routing.md`, and the sections of `~/.claude/templates/BLUEPRINT.md` the command references. Preserve its three operating modes, first-parent commit-trailer checkpoint, bootstrap behavior, cross-task standard discovery, mechanical checks, state-document updates, and distinction between automatic correction and new user decisions.

Use the Codex `follow-up` baseline or a stronger profile from `model-routing.md`. This is a workflow role, not a general capability equivalence claim. The skill cannot change the host model itself: if the active profile is known to be below the baseline, report that the review has not started and recommend rerunning under the required profile rather than performing a weakened checkpoint review.

Codex substitutions:

- Immediately after step 2 fixes the checkpoint range, relevant task IDs, and standards, start the required `diff_reviewer` custom subagent and run step 3 concurrently. Give it only those raw standards plus the checkpoint-range `git log` and `git diff` (or, outside Git, the explicitly scoped paths); do not include the main context's interpretation or defense. Verify every finding against primary evidence before step 5 changes the worktree.
- After step 6 has updated the state artifacts, form the report proposal and run exactly one `proposal_reviewer` custom subagent. Give it the report proposal, raw standards, task IDs, checkpoint-range log and diff (or edited-path list), and in four-layer mode the updated `HANDOFF.md`, `TODO.md`, and `docs/decisions.md` paths. It must challenge the completion judgment and whether those artifacts let a fresh session continue. Verify every returned finding against primary evidence; correct mechanical omissions, but do not re-review after correction.
- Spawn either reviewer with `fork_turns = "none"` or a bounded positive turn count; a full-history fork cannot select a custom role. Their role hooks deny edit tools and git/gh writes. Because Codex reapplies the parent's live permission mode to children, start the parent turn read-only when OS-level prevention of shell writes is required. If custom-role selection is unavailable, use fresh read-only subagents with the corresponding role contracts.
- In Codex-native projects use `.codex/rules`, `.codex/archive`, and `AGENTS.md`. In an unmigrated Claude project retain its existing `.claude` paths and `CLAUDE.md` rather than silently converting it.
- Never let a reviewer edit, commit, push, or change remote state.

Create the checkpoint commit only after the required checks and reviews complete. Report detected omissions, corrections, verification evidence, the new checkpoint, and unresolved user decisions. Do not declare completion while a required check or checkpoint commit remains unfinished.
