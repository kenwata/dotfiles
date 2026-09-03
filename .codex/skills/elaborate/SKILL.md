---
name: elaborate
description: Turn a plan (one phase of a hand-written plan.md, or an approved plan-mode plan) into a durable design document by resolving undecided items through dialogue. Produces docs/design/<slug>.md only; task breakdown is left to the breakdown skill.
---

# Elaborate a plan into a design document

Read `~/.claude/commands/elaborate.md`, `~/.claude/templates/BLUEPRINT.md` §6, and only the skeleton templates that the command calls for. Those files are the canonical workflow shared with Claude Code.

Apply these Codex translations:

- Treat a repository-root `plan.md` as the primary source when it exists (the user writes it in normal conversation before initialization). Elaborate one phase per run. Undecided items are resolved by asking the user through `request_user_input`; asking is not fabrication, silently deciding is.
- Before writing durable artifacts, form your own interpretation and then ask the `advisor` custom subagent to challenge the goal, slug, and scope boundary. Spawn the named role with `fork_turns = "none"` or a bounded positive turn count and give it a self-contained prompt; a full-history fork cannot select a custom role. If custom-role selection is unavailable, use a fresh-context read-only subagent and include the advisor contract in its prompt.
- Do not create or edit `TODO.md`. Write the design document, append its row to `docs/design/index.md` (the design index — create it from `~/.claude/templates/skeletons/design-index.md` when absent; the `T` column stays `—` for the breakdown skill to fill), update `plan.md` / `docs/decisions.md` / `docs/architecture.md` only as the canonical command specifies, and set the next action in `HANDOFF.md` to `/breakdown docs/design/<slug>.md`.
- Run only for plan-level planning (a new phase or initiative). Do not run for a plan whose outcome is verified by an existing `T<n>` completion condition; the granularity rule in `TODO.md` §0 is canonical.
- Use `.codex/archive/` and `.codex/rules/growing-docs.md` in Codex-native projects. Continue using `.claude/...` paths in an existing Claude project unless the user has approved a project-level migration.
- Do not commit unless the canonical workflow and the user's authority permit it.

The outcome is a design document that a later session — possibly without this conversation — can break down into verifiable tasks without reconstructing omitted decisions.
