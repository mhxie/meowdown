import { describe, expect, it } from 'vitest'

import { applySourceEdits, planTaskInsertion, planTaskSourceEdits, scanTaskItems } from './task-source.ts'

const source = '+ [ ] **A**\n  B\n\n  Detail\n'

describe('task source', () => {
  it('separates the complete paragraph, item and removal ranges', () => {
    expect(scanTaskItems(source)).toMatchObject([{
      marker: { from: 2, to: 5 },
      firstParagraph: { from: 2, to: 15 },
      firstParagraphRemoval: { from: 0, to: 16 },
      item: { from: 0, to: 25 },
      firstParagraphMarkdown: '**A**\nB',
    }])
  })

  it('removes all first paragraph lines and retains details', () => {
    const task = scanTaskItems(source).at(0)
    expect(task).toBeDefined()
    if (!task) return
    expect(applySourceEdits(source, planTaskSourceEdits(source, task, { kind: 'removeFirstParagraph' }))).toBe('\n  Detail\n')
  })

  it('edits a multiline paragraph without reserializing details', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    const result = applySourceEdits(source, planTaskSourceEdits(source, task, { kind: 'replaceFirstParagraph', firstParagraphMarkdown: '**New\nparagraph**' }))
    expect(result).toBe('+ [ ] **New\n  paragraph**\n\n  Detail\n')
  })

  it('keeps a heading-looking continuation inside the paragraph', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    const result = applySourceEdits(source, planTaskSourceEdits(source, task, { kind: 'replaceFirstParagraph', firstParagraphMarkdown: 'A\n# literal' }))
    expect(result).toBe('+ [ ] A\n  \\# literal\n\n  Detail\n')
  })

  it('preserves CRLF, uppercase checkbox and nested tasks', () => {
    const markdown = '+ [X] parent\r\n  continued\r\n\r\n  + [ ] child\r\n'
    const tasks = scanTaskItems(markdown)
    expect(tasks.map((task) => task.firstParagraphMarkdown)).toEqual(['parent\ncontinued', 'child'])
    const task = tasks.at(0)
    if (!task) throw new Error('Missing task')
    expect(applySourceEdits(markdown, planTaskSourceEdits(markdown, task, { kind: 'setChecked', value: true }))).toBe(markdown)
  })

  it('reads blockquote task continuations without quote prefixes', () => {
    expect(scanTaskItems('> + [ ] first\n>   second\n').map((task) => task.firstParagraphMarkdown)).toEqual(['first\nsecond'])
  })

  it('ignores fenced checkbox text and retains square checklists', () => {
    expect(scanTaskItems('```\n+ [ ] code\n```\n- [ ] real\n').map((task) => task.bullet)).toEqual(['-'])
  })

  it('rejects stale and overlapping patches before returning any source', () => {
    expect(() => applySourceEdits('abc', [{ range: { from: 0, to: 2 }, expected: 'ab', insert: 'x' }, { range: { from: 1, to: 3 }, expected: 'bc', insert: 'y' }])).toThrow('overlaps')
    expect(() => applySourceEdits('abc', [{ range: { from: 0, to: 1 }, expected: 'z', insert: '' }])).toThrow('stale')
  })

  it('inserts after the complete item rather than before its details', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    expect(applySourceEdits(source, [planTaskInsertion(source, task)])).toBe('+ [ ] **A**\n  B\n\n  Detail\n+ [ ] \n')
  })
})
