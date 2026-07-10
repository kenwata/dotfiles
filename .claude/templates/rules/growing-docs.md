---
paths:
  - ".claude/handoff.md"
  - "**/TODO*.md"
  - "**/todo*.md"
  - "**/CHANGELOG*.md"
  - ".claude/archive/**"
---

# Growing Documents — Verbatim Archive Rotation

Rules for append-only documents that grow over time (handoff, TODO lists, changelogs).
Goal: keep the working file cheap to load, with **zero information loss**.

## Line budget

- `.claude/handoff.md`: 60 lines
- Other growing documents: 120 lines
- A file may override its budget in its header comment; the header comment wins.

## Rotation procedure (run whenever an edit would exceed the budget)

1. Move the oldest entries **verbatim — character for character** — to
   `.claude/archive/<basename>.md`. Create the directory and file on first rotation.
2. Append the moved entries to the end of the archive under a dated heading
   (e.g. `## Rotated 2026-07-10`).
3. Keep one pointer line at the end of the source file:
   `<!-- 過去分: .claude/archive/<basename>.md -->`
4. **Never summarize, paraphrase, or drop entries.** Summarization loses information;
   rotation must be lossless. Sole exception: the handoff "完了" section may simply be
   deleted — git history preserves it.

## Archive properties (`.claude/archive/`)

- Never auto-loaded; read it only when explicitly needed. Zero startup cost.
- Git-managed and append-only: never edit, reorder, or summarize past entries.

## Format rules travel with the file

- When creating a new growing document, embed its format rules as an HTML comment at the
  top of the file (same pattern as the handoff skeleton). This keeps the format stable
  across sessions.
- When editing an existing growing document, **follow its header comment exactly** — do
  not drift from the established format. If the user corrects the format, update the
  header comment in the same edit so the correction sticks for future sessions.
