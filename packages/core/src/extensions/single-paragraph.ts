import { definePlugin, withPriority, Priority, type PlainExtension } from '@prosekit/core'
import { Plugin, PluginKey, TextSelection } from '@prosekit/pm/state'

import { docToParagraphMarkdown, paragraphMarkdownToDoc } from '../converters/paragraph.ts'

import { isNodeOfType } from './node-names.ts'
import { getNodeBuildersForSchema } from './schema.ts'

export const singleParagraphPluginKey = new PluginKey('single-paragraph')

/**
 * Keep editing and pasted content within one paragraph.
 */
export function defineSingleParagraph(): PlainExtension {
  return withPriority(
    definePlugin(
      new Plugin({
        key: singleParagraphPluginKey,
        props: {
          handleTextInput(view, from, to, text) {
            // Raw paragraph editing must run before block input rules consume syntax.
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
