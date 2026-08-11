---
paths:
  - "**/*.md"
  - "**/*.mdx"
---

# Output style

When outputting Markdown, always follow the rules below to prevent rendering issues.

## Spacing around inline decorations

Treat this as a critical rule. It is the one most easily missed when writing Japanese, because words there are not normally separated by spaces.

- Place a half-width space **outside** the markup whenever the neighboring character is kana, kanji, or alphanumeric. Do not place spaces inside the delimiters unless the content itself requires them.
- This applies to every inline decoration: bold, italic, strikethrough, inline code, and inline math / KaTeX delimiters.
- Why: in languages that do not separate words with spaces (Japanese, Chinese, Korean, Thai, etc.), the prose supplies no word boundary, so the decoration sits flush against the text and may fail to render as emphasis or simply read poorly. Space-separated languages like English get that boundary for free.
- Exception: do not add a space on a side that touches full-width punctuation (、。，．・：；！？（）「」『』【】〔〕《》…— etc.). Put the space only on sides adjacent to kana / kanji / alphanumerics.

Correct:

````text
日本語 **重要** 日本語
日本語 *強調* 日本語
日本語 ~~削除~~ 日本語
日本語 `code` 日本語
日本語 $E=mc^2$ 日本語
そのため **役割を固定** します   ← kana on both sides: spaces
**毎回作り直す必要**。            ← 。 on the right: no space there
サブスク（`~/.claude`）で設定     ← （ ） around code: no space inside the parens
````

Incorrect:

````text
日本語**重要**日本語
日本語 ** 重要 ** 日本語
日本語`code`日本語
日本語$E=mc^2$日本語
````

## Code blocks

- Wrap code blocks with four or more backticks as a rule.
- When showing a code block inside another code block, use more backticks on the outer block than on the inner one.
- Always close a code block with the same number of backticks used to open it.
- Add a blank line before and after every code block.

## Tables and lists

- Do not put long text, code blocks, or complex Markdown inside table cells.
- Avoid deeply nested lists; break them into headings and short paragraphs instead.

## Math and diagrams

- Write math in KaTeX-compatible notation. For inline math, place a space before and after the `$` delimiter: $E=mc^2$ .
- Use Mermaid notation for diagrams such as flowcharts.

## Before outputting

Verify that code blocks open and close correctly, that decoration markup has surrounding spaces, and that lists and tables are not broken. Prefer Markdown that copies and renders reliably over Markdown that looks fancy.
