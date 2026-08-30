---
name: initialize
description: Initialize a new or existing project with the user's Codex project guidance, HANDOFF/decision/architecture files, and language rules. Use when the user explicitly asks to initialize or bootstrap this workflow.
---

# Initialize a Codex project

Read `~/.claude/templates/BLUEPRINT.md` and `~/.claude/commands/initialize.md` completely. They are the canonical workflow and failure-history references shared with Claude Code. Apply them with these Codex translations:

| Claude source term | Codex output |
| --- | --- |
| `CLAUDE.md` | `AGENTS.md` |
| `.claude/rules/` | `.codex/rules/` |
| `~/.claude/templates/` | The same canonical templates, translated while writing |
| `AskUserQuestion` | Ask at most the same three decisions through the available user-input mechanism |
| Claude role directories | Nested `AGENTS.md` only when separate directory-scoped roles are actually requested |

Preserve the source workflow's detection-first behavior, idempotency, existing-file protection, HANDOFF/TODO conventions, architecture recording, and verification. Do not overwrite an existing `AGENTS.md`; inspect it and propose only missing sections. Do not create both `CLAUDE.md` and `AGENTS.md` unless the user explicitly asks for a dual-agent project.

When copying a rule, rewrite internal `.claude/rules` references to `.codex/rules`. Because Codex does not automatically apply Claude `paths:` frontmatter, add an `AGENTS.md` pointer telling Codex to load only the `.codex/rules/*.md` files relevant to the paths it will change.

Treat git initialization and commits exactly as the canonical command does: initialize only when needed, and ask before committing into an existing repository. Add or update tests when initialization logic itself changes.
