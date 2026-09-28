import { definePlugin, withPriority, Priority, type PlainExtension } from '@prosekit/core'
import { Plugin, TextSelection } from '@prosekit/pm/state'

import { docToParagraphMarkdown, paragraphMarkdownToDoc } from '../converters/paragraph.ts'

import { isNodeOfType } from './node-names.ts'
import { getNodeBuildersForSchema } from './schema.ts'

/**
 * Keep editing and pasted content within one paragraph.
 */
export function defineSingleParagraph(): PlainExtension {
  return withPriority(
    definePlugin(
      new Plugin({
        props: {
          handleTextInput(view, from, to, text) {
            const paragraph = view.state.doc.resolve(from)
            const prefix = paragraph.parent.textBetween(0, paragraph.parentOffset) + text
            if (!/^(?:#{1,6}|[>\-+*]|\d+[.)]|`{3,}|~{3,})[ \t]/.test(prefix)) return false
            view.dispatch(view.state.tr.insertText(text, from, to))
            return true
          },
        },
        appendTransaction(transactions, _oldState, state) {
          if (!transactions.some((transaction) => transaction.docChanged)) return
          const markdown = docToParagraphMarkdown(state.doc)
          if (
            state.doc.childCount === 1 &&
            isNodeOfType(state.doc.child(0), 'paragraph') &&
            state.doc.child(0).textContent === markdown
          )
            return
          const doc = paragraphMarkdownToDoc(markdown, getNodeBuildersForSchema(state.schema))
          const position = Math.min(state.selection.head, doc.content.size - 1)
          const transaction = state.tr.replaceWith(0, state.doc.content.size, doc.content)
          return transaction.setSelection(
            TextSelection.create(transaction.doc, Math.max(1, position)),
          )
        },
      }),
    ),
    Priority.highest,
  )
}
