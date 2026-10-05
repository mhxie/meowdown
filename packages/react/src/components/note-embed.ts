import { isMarkOfType, type MdWikilinkAttrs } from '@meowdown/core'
import type { Mark, Node as ProseMirrorNode } from '@prosekit/pm/model'
import type { ReactNode } from 'react'

/**
 * A standalone `![[note]]` classified as a note by `resolveWikiEmbed`.
 */
export interface NoteEmbedPayload {
  /**
   * The resolved wiki target; the Markdown source remains unchanged.
   */
  readonly target: string
  /**
   * The resolved alias, or an empty string to display the target.
   */
  readonly display: string
}

/**
 * Render a standalone note embed as host content. The host owns lookup,
 * loading, collapse state, and recursion. Inline embeds remain link chips.
 * Pass a stable function. Passive Markdown views never call this renderer.
 */
export type NoteEmbedRenderer = (embed: NoteEmbedPayload) => ReactNode

/**
 * A paragraph's inline content as runs of text sharing one mark set.
 */
export interface NoteEmbedRun {
  readonly text: string
  readonly marks: readonly Mark[]
}

/**
 * The note embed a paragraph consists of: exactly one `![[...]]` run carrying
 * the `mdWikilink` mark that `resolveWikiEmbed` assigns to notes, with nothing
 * but whitespace around it. Image and file embeds carry other marks, and an
 * unresolved embed carries none, so both keep their ordinary rendering.
 */
export function noteEmbedFromRuns(runs: Iterable<NoteEmbedRun>): NoteEmbedPayload | undefined {
  let payload: NoteEmbedPayload | undefined
  for (const { text, marks } of runs) {
    const mark = marks.find((mark) => isMarkOfType(mark, 'mdWikilink'))
    if (!mark) {
      if (text.trim()) return
      continue
    }
    if (payload || !text.startsWith('![[') || !text.endsWith(']]')) return
    const { target, display } = mark.attrs as MdWikilinkAttrs
    payload = { target, display }
  }
  return payload
}

/**
 * The note embed an editor paragraph consists of; see {@link noteEmbedFromRuns}.
 */
export function standaloneNoteEmbed(node: ProseMirrorNode): NoteEmbedPayload | undefined {
  // Cheap rejection first: this runs on every paragraph update.
  if (!node.textContent.includes('![[')) return
  const runs: NoteEmbedRun[] = []
  for (const child of node.children) {
    // A hard break or other inline node is not part of a standalone embed.
    if (!child.isText) return
    runs.push({ text: child.text ?? '', marks: child.marks })
  }
  return noteEmbedFromRuns(runs)
}
