import type { Transaction } from '@prosekit/pm/state'

const HOST_CONTENT_META = 'meowdown/host-content'

/**
 * Tag a transaction that replaces the document with Markdown supplied by the host.
 */
export function markHostContent(transaction: Transaction): Transaction {
  return transaction.setMeta(HOST_CONTENT_META, true)
}

/**
 * Whether `transaction` replaced the document with Markdown the host supplied
 * through `setMarkdown`, `setState`, or `refreshMarkdownRendering`, rather than
 * an edit made in the editor. Plugins that react to the person's edits (for
 * example, recording that edited text needs review) skip these.
 */
export function isHostContentTransaction(transaction: Transaction): boolean {
  // A plugin's follow-up to a replacement (re-marking inline syntax, say)
  // belongs to it, as ProseMirror's history also judges appended steps.
  const root: unknown = transaction.getMeta('appendedTransaction')
  const origin = root === undefined ? transaction : (root as Transaction)
  return origin.getMeta(HOST_CONTENT_META) === true
}
