import { describe, expect, it } from 'vitest'

import { markdownToDoc } from './md-to-pm.ts'
import { docToParagraphMarkdown, paragraphMarkdownToDoc } from './paragraph.ts'

describe('paragraph content', () => {
  it('keeps heading-looking content and marks inside one paragraph', () => {
    const doc = paragraphMarkdownToDoc('# literal\n**strong**')
    expect(doc.childCount).toBe(1)
    expect(doc.child(0).type.name).toBe('paragraph')
    expect(docToParagraphMarkdown(doc)).toBe('# literal\n**strong**')
  })

  it('flattens pasted blocks into paragraph content', () => {
    expect(docToParagraphMarkdown(markdownToDoc('# heading\n\n> **quote**\n\n- item'))).toBe('heading\n**quote**\nitem')
  })
})
