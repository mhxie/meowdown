import { definePlugin, type PlainExtension } from '@prosekit/core'
import { Plugin, TextSelection } from '@prosekit/pm/state'

import { docToParagraphMarkdown, paragraphMarkdownToDoc } from '../converters/paragraph.ts'
import { getNodeBuildersForSchema } from './schema.ts'

/** Keep editing and pasted content within one paragraph. */
export function defineSingleParagraph(): PlainExtension {
  return definePlugin(new Plugin({
    appendTransaction(transactions, _oldState, state) {
      if (!transactions.some((transaction) => transaction.docChanged)) return
      const markdown = docToParagraphMarkdown(state.doc)
      if (state.doc.childCount === 1 && state.doc.child(0).type.name === 'paragraph' && state.doc.child(0).textContent === markdown) return
      const doc = paragraphMarkdownToDoc(markdown, getNodeBuildersForSchema(state.schema))
      const position = Math.min(state.selection.head, doc.content.size - 1)
      const transaction = state.tr.replaceWith(0, state.doc.content.size, doc.content)
      return transaction.setSelection(TextSelection.create(transaction.doc, Math.max(1, position)))
    },
  }))
}
