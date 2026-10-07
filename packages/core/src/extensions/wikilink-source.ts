import { definePlugin, Priority, withPriority, type PlainExtension } from '@prosekit/core'
import { Plugin, PluginKey, TextSelection, type EditorState } from '@prosekit/pm/state'
import { Decoration, DecorationSet, type EditorView } from '@prosekit/pm/view'

import type { MdWikilinkAttrs } from './inline-marks.ts'
import { getMarkRangeAt } from './mark-range.ts'
import { findWikilinkForElement } from './wikilink-click.ts'

interface SourceRange {
  from: number
  to: number
}

const sourceKey = new PluginKey<SourceRange | null>('meowdown-wikilink-source')

/**
 * Whether the selection is editing a revealed wikilink's original source.
 */
export function isEditingWikilinkSource(state: EditorState): boolean {
  return sourceKey.getState(state) != null
}

function revealSource(view: EditorView, event: MouseEvent | KeyboardEvent): boolean {
  if (!view.editable || !(event.target instanceof HTMLElement)) return false
  const element = event.target.closest<HTMLElement>('.md-wikilink-view-preview.meowdown-reference')
  const selected = getMarkRangeAt(view.state, view.state.selection.from, 'mdWikilink')
  const selectedReference =
    selected &&
    (selected.mark.attrs as MdWikilinkAttrs).appearance === 'reference' &&
    selected.from === view.state.selection.from &&
    selected.to === view.state.selection.to
      ? selected
      : undefined
  const range = element ? findWikilinkForElement(view, element) : selectedReference
  if (!range) return false
  event.preventDefault()
  view.dispatch(
    view.state.tr
      .setMeta(sourceKey, { from: range.from, to: range.to })
      .setMeta('addToHistory', false)
      .setSelection(TextSelection.create(view.state.doc, range.from + 2))
      .scrollIntoView(),
  )
  view.focus()
  return true
}

/**
 * Reveal a numbered wikilink's source with Alt-click or Alt-Enter. Source edits
 * remain ordinary document transactions; Escape or leaving the range folds it.
 */
export function defineWikilinkSourceEditing(): PlainExtension {
  return withPriority(
    definePlugin(
      new Plugin<SourceRange | null>({
        key: sourceKey,
        state: {
          init: () => null,
          apply: (transaction, previous) => {
            const requested = transaction.getMeta(sourceKey) as SourceRange | null | undefined
            if (requested !== undefined) return requested
            if (!previous) return null
            const range = {
              from: transaction.mapping.map(previous.from, -1),
              to: transaction.mapping.map(previous.to, 1),
            }
            const { from, to } = transaction.selection
            return range.from < range.to && from >= range.from && to <= range.to ? range : null
          },
        },
        props: {
          decorations: (state) => {
            const range = sourceKey.getState(state)
            if (!range) return null
            return DecorationSet.create(state.doc, [
              Decoration.inline(range.from, range.to, { class: 'md-wikilink-source-editing' }),
            ])
          },
          handleDOMEvents: {
            mousedown: (view, event) => event.altKey && revealSource(view, event),
            keydown: (view, event) => {
              if (event.altKey && event.key === 'Enter') return revealSource(view, event)
              if (event.key !== 'Escape') return false
              const range = sourceKey.getState(view.state)
              if (!range) return false
              event.preventDefault()
              const mark = getMarkRangeAt(view.state, range.from, 'mdWikilink')
              view.dispatch(
                view.state.tr
                  .setMeta(sourceKey, null)
                  .setMeta('addToHistory', false)
                  .setSelection(TextSelection.create(view.state.doc, mark?.to ?? range.to)),
              )
              return true
            },
          },
        },
      }),
    ),
    Priority.high,
  )
}
