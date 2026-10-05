import {
  getMarkBuilders,
  inlineTextToMarkChunksWithContext,
  isMarkOfType,
  type MdWikilinkAttrs,
  type WikiEmbedResolver,
} from '@meowdown/core'
import type { Node as ProseMirrorNode } from '@prosekit/pm/model'
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

export function standaloneNoteEmbed(
  node: ProseMirrorNode,
  resolveWikiEmbed?: WikiEmbedResolver,
): NoteEmbedPayload | undefined {
  const source = node.textContent.trim()
  if (!source.startsWith('![[') || !source.endsWith(']]')) return
  let payload: NoteEmbedPayload | undefined
  node.forEach((child) => {
    if (!child.isText || child.text !== source) return
    const mark = child.marks.find((mark) => isMarkOfType(mark, 'mdWikilink'))
    if (!mark) return
    const { target, display } = mark.attrs as MdWikilinkAttrs
    payload = { target, display }
  })
  if (payload || !resolveWikiEmbed) return payload
  // MarkdownView parses inline marks at render time; editor nodes already carry them.
  const chunks = inlineTextToMarkChunksWithContext(
    getMarkBuilders(),
    source,
    { resolveWikiEmbed },
    { referenceDefinitions: new Map() },
  )
  if (chunks.length !== 1 || chunks[0][0] !== 0 || chunks[0][1] !== source.length) return
  const mark = chunks[0][2].find((mark) => isMarkOfType(mark, 'mdWikilink'))
  if (!mark) return
  const { target, display } = mark.attrs as MdWikilinkAttrs
  return { target, display }
}
