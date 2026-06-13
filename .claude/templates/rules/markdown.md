---
paths:
  - "**/*.md"
  - "**/*.mdx"
---

# Output style

When outputting Markdown, always follow the rules below to prevent rendering issues.

- Wrap code blocks with four or more backticks as a rule.
- When showing a code block inside another code block, use more backticks on the outer block than on the inner one.
- Always close a code block with the same number of backticks used to open it.
- Add a blank line before and after every code block.
- For syntax that wraps text with special characters on both sides — bold, italic, strikethrough, inline code, etc. — always place a space before and after the markup.
- Use spaces around decorations even inside regular prose: normal **bold** normal.
- Do the same for inline code: the setting is `code` here.
- In languages that do not separate words with spaces (Japanese, Chinese, Korean, Thai, etc.), the surrounding space is not provided automatically by the prose, so you must insert a half-width space deliberately. (In space-separated languages like English the word boundaries satisfy this for free.) Without it the decoration sits flush against the text and may fail to render as emphasis or simply read poorly.
- Exception for those languages: do not add a space on a side that touches full-width punctuation (、。，．・：；！？（）「」『』【】〔〕《》…— etc.). Put the half-width space only on sides adjacent to kana / kanji / alphanumerics, as in:

````text
そのため **役割を固定** します   ← kana on both sides: spaces
**毎回作り直す必要**。            ← 。 on the right: no space there
サブスク（`~/.claude`）で設定     ← （ ） around code: no space inside the parens
````

- Do not put long text, code blocks, or complex Markdown inside table cells.
- Avoid deeply nested lists; break them into headings and short paragraphs instead.
- Before outputting, verify that code blocks open and close correctly, that decoration markup has surrounding spaces, and that lists and tables are not broken.
- Prefer Markdown that copies and renders reliably over Markdown that looks fancy.
- Write math in KaTeX-compatible notation. For inline math, place a space before and after the `$` delimiter: $E=mc^2$ .
- Use Mermaid notation for diagrams such as flowcharts.
