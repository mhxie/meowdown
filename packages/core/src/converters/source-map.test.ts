import { describe, expect, it } from 'vitest'

import { setupHeadlessFixture } from '../testing/headless.ts'

import { markdownToDoc } from './md-to-pm.ts'
import { docToMarkdown } from './pm-to-md.ts'
import { createMarkdownSourceMap } from './source-map.ts'

const { n } = setupHeadlessFixture()

describe('createMarkdownSourceMap', () => {
  it('maps repeated and Unicode text by emitted positions', () => {
    const doc = n.doc(
      n.heading({ level: 2 }, '# 标题'),
      n.paragraph('相同🙂 相同🙂'),
      n.paragraph('相同🙂'),
    )
    const snapshot = createMarkdownSourceMap(doc)
    expect(snapshot.markdown).toBe(docToMarkdown(doc))
    doc.descendants((node, position) => {
      if (!node.isText) return true
      for (let offset = 0; offset < (node.text?.length ?? 0); offset++) {
        const source = snapshot.editorToSource(position + offset)
        expect(source).not.toBeNull()
        expect(snapshot.markdown[source!]).toBe(node.text![offset])
        expect(snapshot.sourceToEditor(source!)).toBe(position + offset)
      }
      return false
    })
    expect(snapshot.sourceToEditor(0)).toBeNull()
  })

  it('accounts for list and quote prefixes on each continuation line', () => {
    const doc = markdownToDoc('> - First\n>   second🙂\n>\n> Third\n')
    const snapshot = createMarkdownSourceMap(doc)
    for (const word of ['First', 'second🙂', 'Third']) {
      const source = snapshot.markdown.indexOf(word)
      const position = snapshot.sourceToEditor(source)
      expect(position).not.toBeNull()
      expect(doc.textBetween(position!, position! + word.length)).toBe(word)
      expect(snapshot.editorToSource(position!)).toBe(source)
    }
    expect(snapshot.sourceToEditor(snapshot.markdown.indexOf('>   second') + 1)).toBeNull()
  })

  it('maps standalone comment edges and inline markers without changing the source', () => {
    const source =
      '<!-- claim:c2 -->\n\nFirst.<!-- /claim:c2 --> Next <!-- claim:c4 -->claim.<!-- /claim:c4 -->\n'
    const doc = markdownToDoc(source)
    const snapshot = createMarkdownSourceMap(doc)
    expect(snapshot.markdown).toBe(source)
    expect(snapshot.sourceToEditor(0)).toBe(0)
    expect(snapshot.sourceToEditor('<!-- claim:c2 -->'.length)).toBe(1)
    expect(snapshot.sourceToEditor(5)).toBeNull()
    const next = snapshot.markdown.indexOf('claim.', 20)
    const position = snapshot.sourceToEditor(next)
    expect(doc.textBetween(position!, position! + 6)).toBe('claim.')
  })

  it('uses the serialized LF snapshot and accounts for frontmatter', () => {
    const doc = markdownToDoc('---\r\nlang: zh-CN\r\n---\r\n\r\n正文🙂\r\n', { frontmatter: true })
    const snapshot = createMarkdownSourceMap(doc, { frontmatter: true })
    expect(snapshot.markdown).not.toContain('\r')
    const offset = snapshot.markdown.indexOf('正文')
    expect(snapshot.sourceToEditor(offset)).toBe(1)
    expect(snapshot.editorToSource(1)).toBe(offset)
    expect(snapshot.sourceToEditor(5)).toBeNull()
    expect(snapshot.sourceToEditor(-1)).toBeNull()
  })
})
