import { definePlugin, Priority, withPriority, type PlainExtension } from '@prosekit/core'
import { Plugin, PluginKey, type EditorState } from '@prosekit/pm/state'
import type { EditorView } from '@prosekit/pm/view'

import { isNodeOfType } from './node-names.ts'

export type FilePasteHandler = (file: File) => string | undefined | Promise<string | undefined>
export type FileSaveErrorHandler = (error: unknown, file: File) => void
/**
 * Whether a saved file is embedded as `![](src)` rather than linked as
 * `[name](src)`.
 */
export type FileEmbedPredicate = (file: { name: string; type?: string }) => boolean
/**
 * The title a saved file gives an untitled document, or `undefined` for none.
 */
export type FileTitleResolver = (file: { name: string; type?: string }) => string | undefined

const filePasteKey = new PluginKey('file-paste')

const IMAGE_FILE_EXTENSIONS = new Set(['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'])

/**
 * Options for {@link defineFilePaste}.
 */
export interface FilePasteOptions {
  /**
   * Persist a pasted/dropped file and return its markdown destination, or
   * `undefined` to decline (nothing is inserted, but the event is consumed).
   * A file `shouldEmbedFile` accepts inserts `![](src)`; any other file
   * inserts a `[name](src)` link.
   */
  onFilePaste?: FilePasteHandler
  /**
   * Called when persisting a pasted/dropped file throws. Defaults to `console.error`.
   */
  onFileSaveError?: FileSaveErrorHandler
  /**
   * Choose which saved files embed as `![](src)`. Defaults to
   * {@link isImageFile}: images embed, every other file is linked.
   */
  shouldEmbedFile?: FileEmbedPredicate
  /**
   * Title a blank document from the files pasted or dropped into it. When the
   * document is an empty leading heading with no other text (a new, untitled
   * note), the first saved file's title fills that heading and every file goes
   * on its own line after it, instead of into the heading. Omit to insert files
   * where they land.
   */
  titleFromFile?: FileTitleResolver
}

/**
 * Whether a file is an image: an `image/*` MIME type or a recognized image
 * filename extension. The default {@link FilePasteOptions.shouldEmbedFile}.
 */
export function isImageFile(file: { name: string; type?: string }): boolean {
  if (file.type?.startsWith('image/')) return true

  const extensionSeparator = file.name.lastIndexOf('.')
  if (extensionSeparator === -1) return false

  const extension = file.name.slice(extensionSeparator + 1).toLowerCase()
  return IMAGE_FILE_EXTENSIONS.has(extension)
}

/**
 * The markdown a saved file becomes: `![](destination)` for a file
 * `shouldEmbedFile` accepts (by default an image: a `type` starting with
 * `image/` or a recognized image filename extension), a `[name](destination)`
 * link otherwise, with `\`, `[`, and `]` escaped in the name. Exported so a
 * host command that inserts file links itself (e.g. an attach-file picker)
 * produces markdown byte-identical to a paste/drop.
 */
export function buildFileMarkdown(
  file: { name: string; type?: string },
  destination: string,
  shouldEmbedFile: FileEmbedPredicate = isImageFile,
): string {
  return shouldEmbedFile(file)
    ? `![](${destination})`
    : `[${escapeLinkText(file.name)}](${destination})`
}

/**
 * The files a configured `onFilePaste` can take, in DataTransfer order.
 * Without a handler no file is taken, so the event is not consumed and the
 * browser's default handling stays in charge.
 */
function takePastedFiles(data: DataTransfer | null, options: FilePasteOptions): File[] {
  if (!data || !options.onFilePaste) return []
  return Array.from(data.files)
}

const defaultOnFileSaveError: FileSaveErrorHandler = (error) => {
  console.error('[meowdown] failed to save pasted file:', error)
}

/**
 * Escape `\`, `[`, and `]` so a filename stays inside its `[text]` label.
 */
function escapeLinkText(name: string): string {
  return name.replaceAll(/[\\[\]]/g, String.raw`\$&`)
}

/**
 * Fill a blank document's empty leading heading with `title` and put
 * `markdown` in a new paragraph right after it, in one undoable step. Returns
 * the position at the end of that paragraph's text, or `undefined` (changing
 * nothing) when the document is not blank or there is no title.
 */
function titleBlankDocument(
  view: EditorView,
  title: string | undefined,
  markdown: string,
): number | undefined {
  const { doc, schema } = view.state
  const heading = doc.firstChild
  const trimmed = title?.trim() ?? ''
  if (
    trimmed === '' ||
    !heading ||
    !isNodeOfType(heading, 'heading') ||
    heading.content.size > 0 ||
    doc.textContent.trim() !== ''
  ) {
    return undefined
  }
  // The heading's content starts at 1; once titled, it closes at title + 2.
  const afterHeading = trimmed.length + 2
  const paragraph = schema.nodes['paragraph']?.create(null, schema.text(markdown))
  if (!paragraph) return undefined
  view.dispatch(view.state.tr.insertText(trimmed, 1).insert(afterHeading, paragraph))
  return afterHeading + 1 + markdown.length
}

async function insertSavedFiles(
  view: EditorView,
  files: File[],
  options: FilePasteOptions,
  at?: number,
): Promise<void> {
  const { onFilePaste } = options
  if (!onFilePaste) return
  const onSaveError = options.onFileSaveError ?? defaultOnFileSaveError
  let position = at
  let insertedAny = false
  for (const file of files) {
    let saved: string | undefined
    try {
      saved = await onFilePaste(file)
    } catch (error) {
      onSaveError(error, file)
      continue
    }
    if (!saved || view.isDestroyed) continue
    const link = buildFileMarkdown(file, saved, options.shouldEmbedFile)
    if (!insertedAny && options.titleFromFile) {
      const end = titleBlankDocument(view, options.titleFromFile(file), link)
      if (end !== undefined) {
        // Later files chain after this one, in the paragraph under the title.
        position = end
        insertedAny = true
        continue
      }
    }
    // Each link after the first starts its own line. `\n` is a soft break in
    // this schema (paragraphs are `whitespace: 'pre'`) and serializes as a
    // literal newline, so the links round-trip one per line.
    const markdown = insertedAny ? `\n${link}` : link
    const transaction =
      position == null
        ? view.state.tr.insertText(markdown)
        : view.state.tr.insertText(markdown, position)
    view.dispatch(transaction)
    insertedAny = true
    // Chain later drops after the one just inserted.
    if (position != null) position += markdown.length
  }
}

function createFilePastePlugin(
  getOptions?: (state: EditorState) => FilePasteOptions | undefined,
): Plugin {
  return new Plugin({
    key: filePasteKey,
    props: {
      handlePaste: (view, event) => {
        const currentOptions = getOptions?.(view.state) ?? {}
        const files = takePastedFiles(event.clipboardData, currentOptions)
        if (files.length === 0) return false
        void insertSavedFiles(view, files, currentOptions)
        return true
      },
      handleDrop: (view, event) => {
        const currentOptions = getOptions?.(view.state) ?? {}
        const files = takePastedFiles(event.dataTransfer, currentOptions)
        if (files.length === 0) return false
        const drop = view.posAtCoords({ left: event.clientX, top: event.clientY })
        void insertSavedFiles(view, files, currentOptions, drop?.pos)
        return true
      },
    },
  })
}

/**
 * Persist pasted/dropped files via `onFilePaste` and insert the returned
 * markdown destination: `![](src)` for an image, a `[name](src)` link for any
 * other file. Multiple files insert one link per line, in DataTransfer order.
 */
export function defineFilePaste(
  getOptions?: (state: EditorState) => FilePasteOptions | undefined,
): PlainExtension {
  // High priority so the drop/paste handler runs before ProseKit's
  // drop-indicator plugin.
  return withPriority(definePlugin(createFilePastePlugin(getOptions)), Priority.high)
}
