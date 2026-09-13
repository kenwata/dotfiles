---
name: follow-up
description: Check planned work against actual changes before completion, correct mechanical omissions, update handoff state, and surface decisions that still need the user. Use for end-of-session or pre-completion reconciliation.
---

# Reconcile plan and outcome

Read `~/.claude/commands/follow-up.md` and the sections of `~/.claude/templates/BLUEPRINT.md` it references. Preserve its three operating modes, baseline selection, mechanical checks, HANDOFF/TODO/decision updates, and distinction between automatic correction and new user decisions.

Codex substitutions:

- Immediately after step 2 fixes the standard and session range, start the required `diff_reviewer` custom subagent and run step 3 concurrently. Give it only the original standard plus the session `git log` and `git diff` (or, outside Git, the paths edited this session); do not include the main context's scope interpretation or defense. Wait for and verify every finding against primary evidence before step 5 changes the worktree. Defer only the handoff-artifact checks that require the post-step-6 state to `proposal_reviewer`.
- After step 6 has updated the handoff artifacts, form the report proposal and run exactly one `proposal_reviewer` custom subagent. Give it the report proposal, the original standard, the session `git log` and `git diff` (or edited-path list), and in four-layer mode the updated `HANDOFF.md`, `TODO.md`, and `docs/decisions.md` paths. It must challenge the completion judgment and, where applicable, whether those artifacts let a fresh session continue. Verify every returned finding against primary evidence; correct mechanical omissions, but do not re-review after correction.
- Spawn either reviewer with `fork_turns = "none"` or a bounded positive turn count; a full-history fork cannot select a custom role. Their role hooks deny edit tools and git/gh writes. Because Codex reapplies the parent's live permission mode to children, start the parent turn read-only when OS-level prevention of shell writes is required. If custom-role selection is unavailable, use fresh read-only subagents with the corresponding role contracts.
- In Codex-native projects use `.codex/rules`, `.codex/archive`, and `AGENTS.md`. In an unmigrated Claude project retain its existing `.claude` paths and `CLAUDE.md` rather than silently converting it.
- Never let a reviewer edit, commit, push, or change remote state.

Report detected omissions, corrections made, verification evidence, and unresolved user decisions. Do not declare completion while a required check remains unverified.
