import type { SyntaxNode } from '@lezer/common'

import type { LezerNodeName } from './node-names.ts'

/**
 * Find a direct child using a name supported by the Markdown grammar.
 */
export function getLezerNodeChild(node: SyntaxNode, type: LezerNodeName): SyntaxNode | null {
  return node.getChild(type)
}
