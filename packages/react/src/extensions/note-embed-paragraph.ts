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
      const { dom, contentDOM } = DOMSerializer.renderSpec(document, spec(node))
      if (!(dom instanceof HTMLElement) || !contentDOM) {
        throw new Error('A paragraph must have an element and contentDOM')
      }
      const source = dom
      const root = payload ? document.createElement('div') : source
      const reader = payload ? document.createElement('div') : null
      let mounted: NoteEmbedMount | null = null
      if (reader && payload) {
        root.className = 'md-note-embed-block'
        source.className = 'md-note-embed-source'
        source.setAttribute('aria-hidden', 'true')
        reader.className = 'md-note-embed-reader'
        reader.contentEditable = 'false'
        root.append(source, reader)
        mounted = mount(reader, payload)
      }
      return {
        dom: root,
        contentDOM,
        update: (next: ProseMirrorNode) => {
          if (!next.sameMarkup(node)) return false
          const nextPayload = standaloneNoteEmbed(next)
          if (Boolean(nextPayload) !== Boolean(payload)) return false
          node = next
          if (nextPayload) mounted?.update(nextPayload)
          return true
        },
        stopEvent: (event) => {
          return event.target instanceof Node && reader?.contains(event.target) === true
        },
        ignoreMutation: (mutation) => {
          if (mutation.type === 'selection') {
            const anchor = document.getSelection()?.anchorNode
            return anchor != null && reader?.contains(anchor) === true
          }
          return reader?.contains(mutation.target) === true
        },
        destroy: () => mounted?.destroy(),
      }
    },
  })
}
