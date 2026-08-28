---
paths:
  - "**/*.md"
  - "**/*.mdx"
---

# Output style

このファイルには、機械的に判定できない・文脈判断が必要な Markdown の規則だけを置く。
装飾(bold/italic/strikethrough/inline code/inline math)の外側スペースや code fence の
backtick 数(4 以上への統一・開始終了の一致)は、このファイルが配置されているプロジェクトでは
PostToolUse hook(`.claude/hooks/format-markdown.sh`、実体は `.claude/hooks/lib/markdown-format`)が
`.md` の Write/Edit のたびに自動整形するため、書く時点で気にする必要はない
(`.mdx` は hook 未対応のため、従来どおり書く時点で守ること)。
hook が検出だけで自動修正できないケース(閉じ fence の欠落、地の文に残った `**`/`~~` らしき記号など)は、
Write/Edit の直後に stderr 経由でその場で報告される。報告があれば、その回の応答で内容を確認し
手で直すこと。

## Tables and lists

- Do not put long text, code blocks, or complex Markdown inside table cells.
- Avoid deeply nested lists; break them into headings and short paragraphs instead.

## Math and diagrams

- Write math in KaTeX-compatible notation.
- Use Mermaid notation for diagrams such as flowcharts.

## Copy/render stability

When a choice remains between multiple valid renderings, prefer the one that copies and
renders more reliably over one that merely looks fancier.
