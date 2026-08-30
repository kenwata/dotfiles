---
name: follow-up
description: Check planned work against actual changes before completion, correct mechanical omissions, update handoff state, and surface decisions that still need the user. Use for end-of-session or pre-completion reconciliation.
---

# Reconcile plan and outcome

Read `~/.claude/commands/follow-up.md` and the sections of `~/.claude/templates/BLUEPRINT.md` it references. Preserve its three operating modes, baseline selection, mechanical checks, HANDOFF/TODO/decision updates, and distinction between automatic correction and new user decisions.

Codex substitutions:

- Run the required fresh-context inspection with the `diff_reviewer` custom subagent. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count; a full-history fork cannot select a custom role. Give it the original standard, paths/commit range, and primary artifacts, but not the main context's defense of its own decisions. Its role hooks deny edit tools and git/gh writes. Because Codex reapplies the parent's live permission mode to children, start the parent turn read-only when OS-level prevention of shell writes is required.
- Verify every returned finding against primary evidence before correcting it.
- Before the final completion report, form your own conclusion and ask the `advisor` custom subagent to challenge it with a fresh or bounded fork. If custom-role selection is unavailable, use fresh read-only subagents with the corresponding role contracts.
- In Codex-native projects use `.codex/rules`, `.codex/archive`, and `AGENTS.md`. In an unmigrated Claude project retain its existing `.claude` paths and `CLAUDE.md` rather than silently converting it.
- Never let a reviewer edit, commit, push, or change remote state.

Report detected omissions, corrections made, verification evidence, and unresolved user decisions. Do not declare completion while a required check remains unverified.
