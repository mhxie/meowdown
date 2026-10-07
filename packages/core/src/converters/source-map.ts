import {
  serializeMarkdownAst,
  type MarkdownNode,
  type MarkdownTextMapping,
} from '@meowdown/markdown'
import type { ProseMirrorNode } from '@prosekit/pm/model'

import { isNodeOfType } from '../extensions/node-names.ts'

import { docToAst } from './pm-to-ast.ts'
import type { DocToMarkdownOptions } from './pm-to-md.ts'

/**
 * Positions index this exact serialized snapshot, in UTF-16 as ProseMirror does.
 */
export interface MarkdownSourceMap {
  readonly markdown: string
  /**
   * Structural syntax and unmapped content return null; association resolves shared edges.
   */
  sourceToEditor(offset: number, assoc?: -1 | 1): number | null
  editorToSource(position: number, assoc?: -1 | 1): number | null
}

interface MappedSpan {
  sourceFrom: number
  sourceTo: number
  editorFrom: number
  editorTo: number
}

interface Origin {
  node: ProseMirrorNode
  position: number
}

/**
 * Map literal prose and standalone comment edges without searching repeated text.
 * Prefixes, fences, table escapes and non-text inline atoms are deliberately unmapped.
 * The serializer owns normalization, so offsets never refer to an older input file.
 */
export function createMarkdownSourceMap(
  doc: ProseMirrorNode,
  options: DocToMarkdownOptions = {},
): MarkdownSourceMap {
  const ast = docToAst(doc)
  const origins = new WeakMap<object, Origin>()
  const spans: MappedSpan[] = []
  function index(node: ProseMirrorNode, source: MarkdownNode, position: number): void {
    origins.set(source, { node, position })
    if (!source.children) return
    node.forEach((child, offset, childIndex) => {
      const sourceChild = source.children?.[childIndex]
      if (sourceChild) index(child, sourceChild, position + (node === doc ? 0 : 1) + offset)
    })
  }
  index(doc, ast, 0)
  function record(mapping: MarkdownTextMapping): void {
    const origin = origins.get(mapping.node)
    if (!origin) return
    if (isNodeOfType(origin.node, 'htmlComment')) {
      if (mapping.textFrom === 0) {
        spans.push({
          sourceFrom: mapping.from,
          sourceTo: mapping.from,
          editorFrom: origin.position,
          editorTo: origin.position,
        })
      }
      if (mapping.textTo === mapping.node.value.length) {
        spans.push({
          sourceFrom: mapping.to,
          sourceTo: mapping.to,
          editorFrom: origin.position + origin.node.nodeSize,
          editorTo: origin.position + origin.node.nodeSize,
        })
      }
      return
    }
    let textOffset = 0
    origin.node.forEach((child, offset) => {
      if (!child.isText) return
      const length = child.text?.length ?? 0
      const from = Math.max(textOffset, mapping.textFrom)
      const to = Math.min(textOffset + length, mapping.textTo)
      if (from <= to) {
        const editorFrom = origin.position + 1 + offset + from - textOffset
        spans.push({
          sourceFrom: mapping.from + from - mapping.textFrom,
          sourceTo: mapping.from + to - mapping.textFrom,
          editorFrom,
          editorTo: editorFrom + to - from,
        })
      }
      textOffset += length
    })
  }
  const markdown = serializeMarkdownAst(ast, { ...options, onText: record })
  const usable = spans.filter((span) => span.sourceTo <= markdown.length)
  function map(value: number, fromEditor: boolean, assoc: -1 | 1): number | null {
    if (!Number.isSafeInteger(value) || value < 0) return null
    let result: number | null = null
    for (const span of usable) {
      const from = fromEditor ? span.editorFrom : span.sourceFrom
      const to = fromEditor ? span.editorTo : span.sourceTo
      if (value < from || value > to) continue
      result = (fromEditor ? span.sourceFrom : span.editorFrom) + value - from
      if (assoc === -1) return result
    }
    return result
  }
  return {
    markdown,
    sourceToEditor: (offset, assoc = 1) => map(offset, false, assoc),
    editorToSource: (position, assoc = 1) => map(position, true, assoc),
  }
}
