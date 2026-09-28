import { parseMarkdownAst } from './parse.ts'
import { walkMarkdownAst } from './path.ts'
import type { MarkdownNode } from './types.ts'

/**
 * Reject content or structure that cannot survive a Markdown round trip.
 */
export function validateSerializedAst(
  node: MarkdownNode,
  markdown: string,
  frontmatter: boolean,
): void {
  if (node.type !== 'document') throw new Error('AST validation requires a document root')
  const parsed = parseMarkdownAst(markdown, { frontmatter })
  const actual = walkMarkdownAst(parsed)
  const document = node.children.length > 0
    ? node
    : {
        ...node,
        children: [{ type: 'paragraph' as const, value: '' }],
      }
  for (const expected of walkMarkdownAst(document)) {
    const entry = actual.next()
    if (
      entry.done ||
      JSON.stringify(expected.path) !== JSON.stringify(entry.value.path) ||
      JSON.stringify(content(expected.node, frontmatter)) !==
        JSON.stringify(content(entry.value.node, frontmatter))
    ) {
      throw new Error(
        `Markdown serialization changes content or structure at ${JSON.stringify(expected.path)}`,
      )
    }
  }
  if (!actual.next().done) throw new Error('Markdown serialization adds unexpected blocks')
}

function content(
  node: MarkdownNode,
  frontmatter: boolean,
): Array<string | number | boolean | undefined> {
  switch (node.type) {
    case 'document':
      return [node.type, frontmatter ? node.frontmatter : undefined]
    case 'paragraph':
    case 'htmlComment':
    case 'text':
      return [node.type, node.value]
    case 'heading':
      return [node.type, node.level, node.value]
    case 'codeBlock':
      return [node.type, node.language, node.value]
    case 'listItem':
      return [
        node.type,
        node.kind,
        node.kind === 'task' && node.checked,
        node.kind === 'bullet' && node.collapsed,
        node.kind === 'ordered' ? (node.order ?? 1) : undefined,
        node.kind === 'task'
          ? node.marker === '+'
            ? '+'
            : node.marker === '*'
              ? '*'
              : '-'
          : undefined,
      ]
    case 'tableCell':
      return [node.type, node.header, node.align]
    case 'ignored':
      return [node.type, node.value, node.hasContent]
    default:
      return [node.type]
  }
}
