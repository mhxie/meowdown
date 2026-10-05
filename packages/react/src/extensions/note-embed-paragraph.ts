import { defineNodeView, type Extension } from '@prosekit/core'
import { DOMSerializer, type Node as ProseMirrorNode } from '@prosekit/pm/model'
import type { NodeView } from '@prosekit/pm/view'

import { standaloneNoteEmbed, type NoteEmbedPayload } from '../components/note-embed.ts'

interface NoteEmbedMount {
  update: (payload: NoteEmbedPayload) => void
  destroy: () => void
}

type MountNoteEmbed = (element: HTMLElement, payload: NoteEmbedPayload) => NoteEmbedMount

/**
 * A source paragraph and its reader are siblings, so embedded Markdown has valid block DOM.
 */
export function defineNoteEmbedParagraphs(mount: MountNoteEmbed): Extension {
  return defineNodeView({
    name: 'paragraph',
    constructor: (initialNode): NodeView => {
      let node = initialNode
      const payload = standaloneNoteEmbed(node)
      const spec = node.type.spec.toDOM
      if (!spec) throw new Error('A paragraph must define toDOM')
      const { dom: source, contentDOM } = DOMSerializer.renderSpec(document, spec(node))
      if (!(source instanceof HTMLElement) || !contentDOM) {
        throw new Error('A paragraph must have an element and contentDOM')
      }
      if (!payload) {
        // An ordinary paragraph; rebuilt by `update` once it becomes an embed.
        return {
          dom: source,
          contentDOM,
          update: (next: ProseMirrorNode) => {
            if (!next.sameMarkup(node) || standaloneNoteEmbed(next)) return false
            node = next
            return true
          },
        }
      }

      const root = document.createElement('div')
      root.className = 'md-note-embed-block'
      source.classList.add('md-note-embed-source')
      source.setAttribute('aria-hidden', 'true')
      const reader = document.createElement('div')
      reader.className = 'md-note-embed-reader'
      reader.contentEditable = 'false'
      root.append(source, reader)
      const mounted = mount(reader, payload)
      return {
        dom: root,
        contentDOM,
        update: (next: ProseMirrorNode) => {
          if (!next.sameMarkup(node)) return false
          const nextPayload = standaloneNoteEmbed(next)
          if (!nextPayload) return false
          node = next
          mounted.update(nextPayload)
          return true
        },
        stopEvent: (event) => event.target instanceof Node && reader.contains(event.target),
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') {
            const anchor = document.getSelection()?.anchorNode
            return anchor != null && reader.contains(anchor)
          }
          return reader.contains(mutation.target)
        },
        destroy: () => mounted.destroy(),
      }
    },
  })
}
