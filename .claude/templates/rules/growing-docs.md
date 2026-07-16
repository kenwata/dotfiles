---
paths:
  - "HANDOFF.md"
  - "**/TODO*.md"
  - "**/todo*.md"
  - "**/CHANGELOG*.md"
  - ".claude/archive/**"
---

# Growing Documents — Verbatim Archive Rotation

Rules for append-only documents that grow over time (handoff, TODO lists, changelogs).
Goal: keep the working file cheap to load, with **zero information loss**.

## Line budget

- `HANDOFF.md`: 40 lines
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
   rotation must be lossless. Sole exception: `HANDOFF.md` is fully overwritten each
   session (not append-only) — its rotation procedure does not apply. Stale content is
   simply replaced, not archived; git history (or the project's decision log, e.g.
   `docs/decisions.md`, if the repo is not git-managed) preserves the prior state.
5. **Verify losslessness mechanically.** After moving entries, diff the moved text
   against a pre-move copy of the source range to confirm a character-for-character
   match. Do not rely on visual inspection alone — a rotation that "looks right" can
   still drop or alter characters (e.g. escaping introduced while reformatting).

## Archive properties (`.claude/archive/`)

- Never auto-loaded; read it only when explicitly needed. Zero startup cost.
- Git-managed and append-only: never edit, reorder, or summarize past entries.

## Placement of durable rules

Where a rule lives determines its context cost and drift risk. Route by scope:

- **CLAUDE.md** — auto-loaded every session. Keep it a thin pointer hub: pointers plus
  only the minimal always-on invariants. Every line is a fixed cost for all sessions.
- **`.claude/rules/`** — the single source of truth for durable rules. Path-scoped
  loading applies them when relevant.
- **Working documents (TODO lists, handoffs, runbooks)** — hold only doc-specific
  conventions (approval markers, role assignments, progress-state definitions) plus
  pointers to the rules. **Never transcribe rule bodies** — a recap duplicated from
  CLAUDE.md or `.claude/rules/` will drift as the source evolves.

When the same rule text exists in two places, pick one as the source of truth and
reduce the other to a pointer.

## Format rules travel with the file

- When creating a new growing document, embed its format rules as an HTML comment at the
  top of the file (same pattern as the handoff skeleton). This keeps the format stable
  across sessions.
- When editing an existing growing document, **follow its header comment exactly** — do
  not drift from the established format. If the user corrects the format, update the
  header comment in the same edit so the correction sticks for future sessions.
