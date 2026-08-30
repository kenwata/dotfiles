---
name: markdown-cleanup
description: Apply the user's deterministic Markdown formatter and linter to explicit files or globs, review semantic risk in the diff, and keep cosmetic work isolated. Use when asked to format or clean Markdown.
---

# Clean Markdown deterministically

Read `~/.claude/commands/markdown-cleanup.md` and `~/.claude/hooks/lib/markdown-format/README.md`. Use the shared formatter at `~/.claude/hooks/lib/markdown-format/cli.mjs`; do not reimplement its rules.

Follow the canonical workflow: resolve explicit Markdown targets, check for existing user changes, run the CLI in whole-file mode, inspect the diff for changes to verbatim quotations or code, and report non-auto-fix lint findings.

Invoke the CLI as `node ~/.claude/hooks/lib/markdown-format/cli.mjs <file> <project-root> --rules-dir=.codex --rules-dir=.claude` with no stdin. Both `--rules-dir` flags are required from Codex: the shared gate defaults to Claude's `.claude/rules/markdown.md` alone, so without them the CLI silently no-ops in a Codex-initialized project. The Codex location for an initialized project's applicability rules is `.codex/rules/markdown.md`; during migration the second flag keeps existing `.claude/rules/markdown.md` projects working.

Formatting a file is authorized by an explicit cleanup request. A commit or push is a separate mutation and still requires the authority described by the repository instructions.
