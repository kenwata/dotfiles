---
name: qmd
description: Search local Markdown knowledge bases, notes, docs, and wikis with the qmd CLI. Use when the answer may exist in indexed local Markdown rather than on the web.
---

# Search indexed Markdown with QMD

Require the `qmd` CLI. If it is unavailable, report that `npm install -g @tobilu/qmd` is the upstream installation path; do not install it without the user's authority.

1. Search for candidate documents.
2. Retrieve the complete relevant sources with `qmd get` or `qmd multi-get`.
3. Answer from retrieved text and cite the returned document ID/path and line numbers.

Prefer a structured conceptual query when the user describes an idea indirectly:

```text
intent: what must be found and nearby concepts to avoid
lex: exact titles, names, symbols, aliases, or rare phrases
vec: a source-like semantic paraphrase
hyde: the document or answer that would satisfy the request
```

Use `qmd search` for exact terms and verbatim phrases. Do not answer factual or nuanced questions from result snippets alone. Use QMD's native range form (`qmd get '<docid>:<from>:<count>'`) instead of piping retrieval through `sed`, `head`, `tail`, or `awk`. Use `--full-path` only when an on-disk path is needed for a file tool.

If semantic query/model setup fails or is too slow, retry with stronger lexical terms through `qmd search`. Treat an empty result as a search claim: state the terms and collections checked rather than inferring that the information does not exist.
