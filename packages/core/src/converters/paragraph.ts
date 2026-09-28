import type { ProseMirrorNode } from '@prosekit/pm/model'

import { getNodeBuilders, type TypedNodeBuilders } from '../extensions/schema.ts'

/**
 * Build one paragraph without interpreting block-opening Markdown.
 */
export function paragraphMarkdownToDoc(
  markdown: string,
  nodes: TypedNodeBuilders = getNodeBuilders(),
): ProseMirrorNode {
  return nodes.doc(
    nodes.paragraph(markdown.replaceAll(/\r\n?/g, '\n').replaceAll(/\n[ \t]*\n+/g, '\n')),
  )
}

/**
 * Flatten textblocks into one paragraph's source content.
 */
export function docToParagraphMarkdown(doc: ProseMirrorNode): string {
  const paragraphs: string[] = []
  doc.descendants((node) => {
    if (!node.isTextblock) return true
    paragraphs.push(node.textContent)
    return false
  })
  return paragraphs
    .join('\n')
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/\n[ \t]*\n+/g, '\n')
}
