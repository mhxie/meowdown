import { expect, it } from 'vitest'

import { readBlockSource } from './leaf-text.ts'
import { gfmParser } from './parser.ts'

it.each([
  '> [ref]:\n>   https://example.com "Example"',
  '+ [ref]:\n    https://example.com "Example"',
  '> + [ref]:\n>     https://example.com "Example"',
])('reads a reference definition without its container: %s', (source) => {
  const definitions: string[] = []
  gfmParser.parse(source).iterate({
    enter(node) {
      if (node.name === 'LinkReference') definitions.push(readBlockSource(source, node.node))
    },
  })
  expect(definitions).toEqual(['[ref]:\n  https://example.com "Example"'])
})
