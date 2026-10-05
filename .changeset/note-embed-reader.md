---
'@meowdown/core': patch
'@meowdown/react': minor
---

Add an optional `renderNoteEmbed` host renderer to the editor and `MarkdownView` for standalone `![[note]]` paragraphs. Readers preserve the original Markdown, retain React providers, and leave inline links and passive previews unchanged.

Add `MarkdownView.headingOffset` to render embedded headings at deeper semantic levels, capped at H6, without changing the source.
