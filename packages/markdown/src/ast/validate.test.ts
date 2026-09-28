import { describe, expect, it } from 'vitest'

import { getTaskParagraph, parseMarkdownAst, serializeMarkdownAst } from '../index.ts'

function replaceParagraph(source: string, value: string) {
  const document = parseMarkdownAst(source)
  const paragraph = getTaskParagraph(document.children[0])
  if (!paragraph) throw new Error('Expected a task paragraph')
  paragraph.value = value
  return document
}

describe('validated serialization', () => {
  it('preserves first-line block openers after a checkbox', () => {
    const document = replaceParagraph('+ [ ] old', '# **literal** and *italic*')
    expect(serializeMarkdownAst(document, { validate: true })).toBe(
      '+ [ ] # **literal** and *italic*\n',
    )
  })

  it('rejects a continuation that becomes a heading without mutating the AST', () => {
    const document = replaceParagraph('+ [ ] old', 'first\n# heading')
    const before = structuredClone(document)
    expect(() => serializeMarkdownAst(document, { validate: true })).toThrow(/content or structure/)
    expect(document).toEqual(before)
  })

  it('rejects a blank line that splits the editable paragraph', () => {
    const document = replaceParagraph('+ [ ] old', 'first\n\nsecond')
    expect(() => serializeMarkdownAst(document, { validate: true })).toThrow(/content or structure/)
  })

  it('accepts an explicitly escaped continuation as paragraph Markdown', () => {
    const document = replaceParagraph('+ [ ] old', 'first\n\\# literal')
    expect(serializeMarkdownAst(document, { validate: true })).toBe('+ [ ] first\n  \\# literal\n')
  })

  it('rejects a malformed task whose first child is a heading', () => {
    const document = parseMarkdownAst('+ [ ] old')
    const item = document.children[0]
    if (item.type !== 'listItem') throw new Error('Expected task')
    item.children[0] = { type: 'heading', level: 2, value: 'heading' }
    expect(() => serializeMarkdownAst(document, { validate: true })).toThrow(/content or structure/)
  })

  it('normalizes whitespace and formatting while preserving complex task structure', () => {
    const source =
      '---\r\nname: test\r\n---\r\n\r\n+ [ ] 😀 **first**\r\n  *second*\r\n\r\n  > quote\r\n\r\n  ~~~js\r\n  code\r\n  ~~~\r\n\r\n  | a | b |\r\n  | :--- | ---: |\r\n  | c | d |\r\n'
    const document = parseMarkdownAst(source, { frontmatter: true })
    const output = serializeMarkdownAst(document, { frontmatter: true, validate: true })
    expect(output).toContain('😀 **first**\n  *second*')
    expect(output).toContain('| :-- | --: |')
    expect(output).not.toContain('\r')
    expect(parseMarkdownAst(output, { frontmatter: true })).toEqual(document)
  })

  it('retains lazy continuation content in a quoted task', () => {
    const document = parseMarkdownAst('> + [ ] first\nsecond\n')
    expect(() => serializeMarkdownAst(document, { validate: true })).not.toThrow()
  })

  it('retains tab-indented nested task content', () => {
    const document = parseMarkdownAst('+ [ ] parent\n\t+ [ ] child\n')
    expect(() => serializeMarkdownAst(document, { validate: true })).not.toThrow()
  })

  it('rejects top-level paragraph text that would become a different block', () => {
    expect(() => {
      return serializeMarkdownAst(
        { type: 'document', children: [{ type: 'paragraph', value: '# heading' }] },
        { validate: true },
      )
    }).toThrow(/content or structure/)
  })

  it('requires a document root when validating', () => {
    expect(() => {
      return serializeMarkdownAst({ type: 'paragraph', value: 'text' }, { validate: true })
    }).toThrow('document root')
  })

  it('serializes a document after its last task is removed', () => {
    const document = parseMarkdownAst('+ [ ] last')
    document.children.shift()
    expect(serializeMarkdownAst(document, { validate: true })).toBe('\n')
  })

  it('validates the empty document', () => {
    expect(serializeMarkdownAst(parseMarkdownAst(''), { validate: true })).toBe('\n')
  })
})
