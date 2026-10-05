import { useExtension } from '@prosekit/react'
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

import { defineNoteEmbedParagraphs } from '../extensions/note-embed-paragraph.ts'

import type { NoteEmbedPayload, NoteEmbedRenderer } from './note-embed.ts'

interface NoteEmbedPortal {
  readonly key: string
  readonly element: HTMLElement
  readonly payload: NoteEmbedPayload
}

function createPortalStore() {
  let portals: readonly NoteEmbedPortal[] = []
  let nextKey = 0
  const listeners = new Set<() => void>()
  function publish(next: readonly NoteEmbedPortal[]): void {
    portals = next
    for (const listener of listeners) listener()
  }
  return {
    snapshot: () => portals,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    mount: (element: HTMLElement, payload: NoteEmbedPayload) => {
      const key = String(nextKey++)
      publish([...portals, { key, element, payload }])
      return {
        update: (next: NoteEmbedPayload) => {
          if (next.target === payload.target && next.display === payload.display) return
          payload = next
          publish(portals.map((portal) => (portal.key === key ? { ...portal, payload } : portal)))
        },
        destroy: () => publish(portals.filter((portal) => portal.key !== key)),
      }
    },
  }
}

interface NoteEmbedViewsProps {
  renderNoteEmbed: NoteEmbedRenderer
}

/**
 * Keep host readers in React's existing provider tree while the editor owns their DOM.
 */
export function NoteEmbedViews({ renderNoteEmbed }: NoteEmbedViewsProps): ReactNode {
  const [store] = useState(createPortalStore)
  const portals = useSyncExternalStore(store.subscribe, store.snapshot)
  useExtension(useMemo(() => defineNoteEmbedParagraphs(store.mount), [store]))
  return portals.map(({ key, element, payload }) => {
    return createPortal(renderNoteEmbed(payload), element, key)
  })
}
