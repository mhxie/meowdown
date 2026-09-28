import type { SyntaxNode, Tree } from '@lezer/common'

import { dedentContinuation, measureContentColumn, readLeafText } from './leaf-text.ts'
import { getLezerNodeChild } from './node-child.ts'
import { gfmParser } from './parser.ts'

/**
 * Half-open UTF-16 offsets in the supplied source string.
 */
export interface SourceRange {
  readonly from: number
  readonly to: number
}

export interface SourceEdit {
  readonly range: SourceRange
  readonly expected: string
  readonly insert: string
}

/**
 * One parsed checkbox item. All ranges are half-open UTF-16 offsets into the
 * exact source passed to `scanTaskItems`; they are not stable task identifiers.
 *
 * @example
 * For `"+ [ ] first\n  second\n\n  detail"`, `marker` selects `[ ]`,
 * `firstParagraph` selects `[ ] first\n  second`, and `item` includes `detail`.
 * `firstParagraphRemoval` additionally includes the leading `+ ` and the first
 * paragraph's ending newline, but leaves the blank line and detail unchanged.
 * `firstParagraphMarkdown` is `"first\nsecond"`; `contentFrom` points at `f`.
 * `continuationPrefix` is `"  "` and `siblingPrefix` is `"+ "`.
 */
export interface TaskSourceItem {
  /**
   * Exactly the three checkbox characters, excluding the list bullet.
   */
  readonly marker: SourceRange
  /**
   * Original checkbox spelling; preserves uppercase `[X]` on unrelated edits.
   */
  readonly markerText: '[ ]' | '[x]' | '[X]'
  /**
   * Original list marker, such as `+`, `-`, `*`, or `1.`.
   */
  readonly bullet: string
  /**
   * Whether the checkbox contains `x` or `X`.
   */
  readonly checked: boolean
  /**
   * Task paragraph including its checkbox and source continuation prefixes,
   * excluding the ending newline and subsequent blocks.
   */
  readonly firstParagraph: SourceRange
  /**
   * Physical lines removed when deleting only the first paragraph, including
   * its first-line container prefix and ending LF/CRLF when present.
   */
  readonly firstParagraphRemoval: SourceRange
  /**
   * Complete list item, including later paragraphs, blocks, and nested items.
   */
  readonly item: SourceRange
  /**
   * Editable inline Markdown with checkbox/container prefixes removed and
   * CRLF normalized to LF; inline marks and hard-break syntax remain intact.
   */
  readonly firstParagraphMarkdown: string
  /**
   * Source offset after the checkbox and its optional single space or tab.
   */
  readonly contentFrom: number
  /**
   * Quote/list indentation prepended to each serialized continuation line.
   */
  readonly continuationPrefix: string
  /**
   * Container prefix plus list bullet and spacing for an inserted sibling.
   */
  readonly siblingPrefix: string
}

export type TaskSourceMutation =
  | { readonly kind: 'setChecked'; readonly value: boolean }
  | { readonly kind: 'replaceFirstParagraph'; readonly firstParagraphMarkdown: string }
  | { readonly kind: 'removeFirstParagraph' }
  | { readonly kind: 'toBullet' }

export function readTaskMarker(
  text: string,
):
  | { checked: boolean; character: 'x' | 'X' | undefined; text: TaskSourceItem['markerText'] }
  | undefined {
  if (text !== '[ ]' && text !== '[x]' && text !== '[X]') return
  return {
    checked: text !== '[ ]',
    character: text === '[ ]' ? undefined : text === '[X]' ? 'X' : 'x',
    text,
  }
}

/**
 * Read a Task node with its list item's continuation column.
 */
export function readTaskFirstParagraph(source: string, node: SyntaxNode, column: number): string {
  const marker = getLezerNodeChild(node, 'TaskMarker')
  if (!marker) throw new Error('Expected a task marker')
  let from = marker.to
  if (source[from] === ' ' || source[from] === '\t') from++
  const end = source[node.to - 1] === '\r' ? node.to - 1 : node.to
  return dedentContinuation(readLeafText(node.cursor(), source, from, end), column).replaceAll(
    '\r\n',
    '\n',
  )
}

/**
 * Scan real task nodes, including tasks nested in quotes and lists.
 */
export function scanTaskItems(
  source: string,
  tree: Tree = gfmParser.parse(source),
): TaskSourceItem[] {
  const tasks: TaskSourceItem[] = []
  tree.iterate({
    enter(reference) {
      if (reference.name !== 'Task') return
      const node = reference.node
      const item = node.parent
      const marker = getLezerNodeChild(node, 'TaskMarker')
      const listMark = item ? getLezerNodeChild(item, 'ListMark') : null
      if (!item || !marker || !listMark) return
      const parsed = readTaskMarker(source.slice(marker.from, marker.to))
      if (!parsed) return
      const lineFrom = source.lastIndexOf('\n', marker.from - 1) + 1
      const { continuationPrefix, siblingPrefix, column } = getTaskPrefixes(
        source,
        item,
        marker.from,
      )
      const paragraphEnd = source[node.to - 1] === '\r' ? node.to - 1 : node.to
      const itemEnd = source[item.to - 1] === '\r' ? item.to - 1 : item.to
      let contentFrom = marker.to
      if (source[contentFrom] === ' ' || source[contentFrom] === '\t') contentFrom++
      let end = paragraphEnd
      if (source[end] === '\r') end++
      if (source[end] === '\n') end++
      tasks.push({
        marker: { from: marker.from, to: marker.to },
        markerText: parsed.text,
        bullet: source.slice(listMark.from, listMark.to),
        checked: parsed.checked,
        firstParagraph: { from: node.from, to: paragraphEnd },
        firstParagraphRemoval: { from: lineFrom, to: end },
        item: { from: item.from, to: itemEnd },
        firstParagraphMarkdown: readTaskFirstParagraph(source, node, column),
        contentFrom,
        continuationPrefix,
        siblingPrefix,
      })
    },
  })
  return tasks
}

function getTaskPrefixes(
  source: string,
  item: SyntaxNode,
  markerOffset: number,
): { continuationPrefix: string; siblingPrefix: string; column: number } {
  const lineFrom = source.lastIndexOf('\n', markerOffset - 1) + 1
  let continuationPrefix = source.slice(lineFrom, markerOffset)
  let siblingPrefix = continuationPrefix
  for (let ancestor: SyntaxNode | null = item; ancestor; ancestor = ancestor.parent) {
    const mark = ancestor.name === 'ListItem' ? getLezerNodeChild(ancestor, 'ListMark') : null
    if (!mark || mark.from < lineFrom || mark.to > markerOffset) continue
    const start = mark.from - lineFrom
    const end = mark.to - lineFrom
    continuationPrefix =
      continuationPrefix.slice(0, start) + ' '.repeat(end - start) + continuationPrefix.slice(end)
    if (ancestor !== item)
      siblingPrefix =
        siblingPrefix.slice(0, start) + ' '.repeat(end - start) + siblingPrefix.slice(end)
  }
  let localPrefix = continuationPrefix.slice(continuationPrefix.lastIndexOf('>') + 1)
  if (continuationPrefix.includes('>') && localPrefix.startsWith(' '))
    localPrefix = localPrefix.slice(1)
  return {
    continuationPrefix,
    siblingPrefix,
    column: measureContentColumn(localPrefix, localPrefix.length),
  }
}

/**
 * Apply non-overlapping edits against one immutable source snapshot.
 */
export function applySourceEdits(source: string, edits: readonly SourceEdit[]): string {
  const sorted = [...edits].sort((left, right) => right.range.from - left.range.from)
  let boundary = source.length
  for (const edit of sorted) {
    const { from, to } = edit.range
    if (
      !Number.isSafeInteger(from) ||
      !Number.isSafeInteger(to) ||
      from < 0 ||
      to < from ||
      to > boundary ||
      source.slice(from, to) !== edit.expected
    ) {
      throw new Error('Source edit is stale or overlaps another edit')
    }
    source = source.slice(0, from) + edit.insert + source.slice(to)
    boundary = from
  }
  return source
}

/**
 * Plan a mutation against the exact source from which the task was scanned.
 */
export function planTaskSourceEdits(
  source: string,
  task: TaskSourceItem,
  mutation: TaskSourceMutation,
): SourceEdit[] {
  const edit = (range: SourceRange, insert: string): SourceEdit[] => [
    { range, expected: source.slice(range.from, range.to), insert },
  ]
  if (source.slice(task.marker.from, task.marker.to) !== task.markerText)
    throw new Error('Task marker is stale')
  if (mutation.kind === 'setChecked')
    return edit(task.marker, mutation.value ? (task.markerText === '[X]' ? '[X]' : '[x]') : '[ ]')
  if (mutation.kind === 'removeFirstParagraph') return edit(task.firstParagraphRemoval, '')
  if (mutation.kind === 'toBullet')
    return edit({ from: task.marker.from, to: task.contentFrom }, '')
  const newline = source
    .slice(task.firstParagraphRemoval.from, task.firstParagraphRemoval.to)
    .includes('\r\n')
    ? '\r\n'
    : '\n'
  // Pasted blocks become soft lines. Empty boundary lines are not paragraph content.
  const content = mutation.firstParagraphMarkdown
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/\n[ \t]*\n+/g, '\n')
    .replaceAll(/^\n+|\n+$/g, '')
  const lines = content.split('\n').map((line, index) => {
    if (index === 0) return line
    const probe = 'text\n' + line
    const block = gfmParser.parse(probe).topNode.firstChild
    if (block?.name === 'Paragraph' && block.to === probe.length && !block.nextSibling) return line
    // Only escape a continuation that actually opens a block. Ordinary hashtags
    // and inline marks already returned above, preserving their source spelling.
    return line
      .replace(/^(\s*)([#>+*<`~=-])/, String.raw`$1\$2`)
      .replace(/^(\s*\d+)([.)])(?=\s)/, String.raw`$1\$2`)
  })
  const replacement = lines.join(newline + task.continuationPrefix)
  return edit({ from: task.marker.to, to: task.firstParagraph.to }, ' ' + replacement)
}

/**
 * A caller-selected insertion boundary. Heading/section selection remains the
 * caller's policy; this layer only writes list syntax at the chosen location.
 */
export type TaskInsertionTarget =
  | { readonly kind: 'afterItem'; readonly item: TaskSourceItem }
  | {
      readonly kind: 'position'
      readonly offset: number
      /**
       * Container prefix and bullet, for example `"+ "` or `">   - "`.
       */
      readonly prefix?: string
      /**
       * Separate a newly started list from surrounding prose with blank lines.
       */
      readonly separate?: boolean
    }

export interface TaskInsertionOptions {
  /**
   * Defaults to a top-level round task at the end of the supplied source.
   */
  readonly target?: TaskInsertionTarget
  readonly firstParagraphMarkdown?: string
  readonly checked?: boolean
}

/**
 * Plan one insertion without choosing application-specific headings or sections.
 * Source offsets refer to the unmodified input, including frontmatter if present.
 * The returned edit can be combined with other non-overlapping source edits.
 *
 * @example
 * // Continue a particular list, retaining its quote/list prefix.
 * planTaskInsertion(source, { target: { kind: 'afterItem', item } })
 * // Start a list beneath a heading selected by the caller.
 * planTaskInsertion(source, {
 *   target: { kind: 'position', offset: headingEnd, prefix: '+ ', separate: true },
 *   firstParagraphMarkdown: 'Buy **milk**',
 * })
 */
export function planTaskInsertion(source: string, options: TaskInsertionOptions = {}): SourceEdit {
  const { offset, prefix, leading, trailing } = insertionBoundary(source, options.target)
  const edit: SourceEdit = {
    range: { from: offset, to: offset },
    expected: '',
    insert: `${leading}${prefix}[${options.checked ? 'x' : ' '}] ${trailing}`,
  }
  const markerOffset = offset + leading.length + prefix.length
  const inserted = applySourceEdits(source, [edit])
  const task = scanTaskItems(inserted).find((item) => item.marker.from === markerOffset)
  if (!task) throw new Error('Insertion does not create a task')
  if (options.firstParagraphMarkdown) {
    const populated = applySourceEdits(
      inserted,
      planTaskSourceEdits(inserted, task, {
        kind: 'replaceFirstParagraph',
        firstParagraphMarkdown: options.firstParagraphMarkdown,
      }),
    )
    return { ...edit, insert: populated.slice(offset, offset + populated.length - source.length) }
  }
  return edit
}

function insertionBoundary(source: string, target: TaskInsertionTarget | undefined) {
  const after = target?.kind === 'afterItem' ? target.item : undefined
  const offset = target?.kind === 'position' ? target.offset : (after?.item.to ?? source.length)
  const newline = source.includes('\r\n') ? '\r\n' : '\n'
  const prefix =
    target?.kind === 'position' ? (target.prefix ?? '+ ') : (after?.siblingPrefix ?? '+ ')
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > source.length ||
    /[\r\n]/.test(prefix)
  )
    throw new Error('Invalid task insertion boundary')
  const separate = target?.kind === 'position' && target.separate === true
  const { leading, trailing } = insertionSpacing(source, offset, newline, separate)
  return { offset, prefix, leading, trailing }
}

function insertionSpacing(source: string, offset: number, newline: string, separate: boolean) {
  let leading = offset > 0 && source[offset - 1] !== '\n' ? newline : ''
  let trailing = source[offset] === '\r' || source[offset] === '\n' ? '' : newline
  if (separate) {
    if (offset > 0 && !(source.slice(0, offset) + leading).endsWith(newline + newline))
      leading += newline
    if (offset < source.length && !(trailing + source.slice(offset)).startsWith(newline + newline))
      trailing += newline
  }
  return { leading, trailing }
}
