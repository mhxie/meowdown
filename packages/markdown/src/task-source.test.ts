import { describe, expect, it } from 'vitest'

import {
  applySourceEdits,
  planTaskInsertion,
  planTaskSourceEdits,
  scanTaskItems,
} from './task-source.ts'

const source = '+ [ ] **A**\n  B\n\n  Detail\n'

describe('task source', () => {
  it('separates the complete paragraph, item and removal ranges', () => {
    expect(scanTaskItems(source)).toMatchObject([
      {
        marker: { from: 2, to: 5 },
        firstParagraph: { from: 2, to: 15 },
        firstParagraphRemoval: { from: 0, to: 16 },
        item: { from: 0, to: 25 },
        firstParagraphMarkdown: '**A**\nB',
      },
    ])
  })

  it('removes all first paragraph lines and retains details', () => {
    const task = scanTaskItems(source).at(0)
    expect(task).toBeDefined()
    if (!task) return
    expect(
      applySourceEdits(source, planTaskSourceEdits(source, task, { kind: 'removeFirstParagraph' })),
    ).toBe('\n  Detail\n')
  })

  it('edits a multiline paragraph without reserializing details', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    const result = applySourceEdits(
      source,
      planTaskSourceEdits(source, task, {
        kind: 'replaceFirstParagraph',
        firstParagraphMarkdown: '**New\nparagraph**',
      }),
    )
    expect(result).toBe('+ [ ] **New\n  paragraph**\n\n  Detail\n')
  })

  it('keeps a heading-looking continuation inside the paragraph', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    const result = applySourceEdits(
      source,
      planTaskSourceEdits(source, task, {
        kind: 'replaceFirstParagraph',
        firstParagraphMarkdown: 'A\n# literal',
      }),
    )
    expect(result).toBe('+ [ ] A\n  \\# literal\n\n  Detail\n')
  })

  it('preserves CRLF, uppercase checkbox and nested tasks', () => {
    const markdown = '+ [X] parent\r\n  continued\r\n\r\n  + [ ] child\r\n'
    const tasks = scanTaskItems(markdown)
    expect(tasks.map((task) => task.firstParagraphMarkdown)).toEqual(['parent\ncontinued', 'child'])
    const task = tasks.at(0)
    if (!task) throw new Error('Missing task')
    expect(
      applySourceEdits(
        markdown,
        planTaskSourceEdits(markdown, task, { kind: 'setChecked', value: true }),
      ),
    ).toBe(markdown)
  })

  it('reads blockquote task continuations without quote prefixes', () => {
    expect(
      scanTaskItems('> + [ ] first\n>   second\n').map((task) => task.firstParagraphMarkdown),
    ).toEqual(['first\nsecond'])
  })

  it('ignores fenced checkbox text and retains square checklists', () => {
    expect(scanTaskItems('```\n+ [ ] code\n```\n- [ ] real\n').map((task) => task.bullet)).toEqual([
      '-',
    ])
  })

  it('rejects stale and overlapping patches before returning any source', () => {
    expect(() => {
      return applySourceEdits('abc', [
        { range: { from: 0, to: 2 }, expected: 'ab', insert: 'x' },
        { range: { from: 1, to: 3 }, expected: 'bc', insert: 'y' },
      ])
    }).toThrow('overlaps')
    expect(() => {
      return applySourceEdits('abc', [{ range: { from: 0, to: 1 }, expected: 'z', insert: '' }])
    }).toThrow('stale')
  })

  it('inserts after the complete item rather than before its details', () => {
    const task = scanTaskItems(source).at(0)
    if (!task) throw new Error('Missing task')
    expect(
      applySourceEdits(source, [
        planTaskInsertion(source, { target: { kind: 'afterItem', item: task } }),
      ]),
    ).toBe('+ [ ] **A**\n  B\n\n  Detail\n+ [ ] \n')
  })
})

it('preserves every CRLF boundary while replacing and inserting', () => {
  const markdown = '+ [ ] A\r\n  B\r\n\r\n  Detail\r\n'
  const task = scanTaskItems(markdown)[0]
  if (!task) throw new Error('Missing task')
  expect(task.firstParagraphMarkdown).toBe('A\nB')
  expect(
    applySourceEdits(
      markdown,
      planTaskSourceEdits(markdown, task, {
        kind: 'replaceFirstParagraph',
        firstParagraphMarkdown: 'C\nD',
      }),
    ),
  ).toBe('+ [ ] C\r\n  D\r\n\r\n  Detail\r\n')
  expect(
    applySourceEdits(markdown, [
      planTaskInsertion(markdown, { target: { kind: 'afterItem', item: task } }),
    ]),
  ).toBe('+ [ ] A\r\n  B\r\n\r\n  Detail\r\n+ [ ] \r\n')
  expect(
    applySourceEdits(
      markdown,
      planTaskSourceEdits(markdown, task, { kind: 'removeFirstParagraph' }),
    ),
  ).toBe('\r\n  Detail\r\n')
})

it('does not escape inline marks at a continuation start', () => {
  const task = scanTaskItems(source)[0]
  if (!task) throw new Error('Missing task')
  const content = 'A\n**bold**\n*italic*\n`code`'
  const result = applySourceEdits(
    source,
    planTaskSourceEdits(source, task, {
      kind: 'replaceFirstParagraph',
      firstParagraphMarkdown: content,
    }),
  )
  expect(scanTaskItems(result)[0]?.firstParagraphMarkdown).toBe(content)
})

it('round-trips task continuation indentation expressed with a tab', () => {
  const markdown = '+\t[ ] A\n\tB\n'
  const task = scanTaskItems(markdown)[0]
  if (!task) throw new Error('Missing task')
  const result = applySourceEdits(
    markdown,
    planTaskSourceEdits(markdown, task, {
      kind: 'replaceFirstParagraph',
      firstParagraphMarkdown: 'A\nB',
    }),
  )
  expect(scanTaskItems(result)[0]?.firstParagraphMarkdown).toBe('A\nB')
})

it('reads a quoted task inside a list', () => {
  expect(scanTaskItems('+ parent\n  > + [ ] A\n  >   B\n')[0]?.firstParagraphMarkdown).toBe('A\nB')
})

it('replaces and inserts a same-line nested task without duplicating its parent', () => {
  const markdown = '- + [ ] A\n    B\n'
  const task = scanTaskItems(markdown)[0]
  if (!task) throw new Error('Missing task')
  expect(
    applySourceEdits(
      markdown,
      planTaskSourceEdits(markdown, task, {
        kind: 'replaceFirstParagraph',
        firstParagraphMarkdown: 'C\nD',
      }),
    ),
  ).toBe('- + [ ] C\n    D\n')
  expect(
    applySourceEdits(markdown, [
      planTaskInsertion(markdown, { target: { kind: 'afterItem', item: task } }),
    ]),
  ).toBe('- + [ ] A\n    B\n  + [ ] \n')
})

it('refuses insertion into an unclosed fence', () => {
  expect(() => planTaskInsertion('```\ncode')).toThrow('does not create a task')
})

it.each([
  ['#my_tag', '#my_tag'],
  ['first\n#my_tag', 'first\n#my_tag'],
  ['first\n**bold** and *italic*', 'first\n**bold** and *italic*'],
  ['first\n\nsecond\n', 'first\nsecond'],
  ['\nfirst\n', 'first'],
])('accepts paragraph input %s without unnecessary escaping', (input, expected) => {
  const task = scanTaskItems(source)[0]
  const next = applySourceEdits(
    source,
    planTaskSourceEdits(source, task, {
      kind: 'replaceFirstParagraph',
      firstParagraphMarkdown: input,
    }),
  )
  expect(scanTaskItems(next)[0]?.firstParagraphMarkdown).toBe(expected)
  expect(next.endsWith('\n\n  Detail\n')).toBe(true)
})

it('inserts supplied content below a caller-selected heading without touching later sections', () => {
  const markdown = '## Tasks\n\n## Other\n\nkeep me\n'
  const edit = planTaskInsertion(markdown, {
    target: { kind: 'position', offset: '## Tasks'.length, separate: true },
    firstParagraphMarkdown: 'Buy **milk**',
    checked: true,
  })
  expect(applySourceEdits(markdown, [edit])).toBe(
    '## Tasks\n\n+ [x] Buy **milk**\n\n## Other\n\nkeep me\n',
  )
})
