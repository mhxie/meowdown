import type { SyntaxNode, Tree } from '@lezer/common'

import { dedentContinuation, measureContentColumn, readLeafText } from './leaf-text.ts'
import { getLezerNodeChild } from './node-child.ts'
import { gfmParser } from './parser.ts'

/**
 * A half-open range in one immutable source string: `source.slice(from, to)`.
 * Coordinates count UTF-16 code units, like JavaScript string indices, not
 * bytes, Unicode code points, line numbers, or stable task IDs. Re-scan or map
 * ranges after changing the source; never reuse them against an unrelated edit.
 *
 * @example
 * // The emoji occupies two UTF-16 code units.
 * const source = '😀 [ ]'
 * const marker: SourceRange = { from: 3, to: 6 }
 * source.slice(marker.from, marker.to) // '[ ]'
 */
export interface SourceRange {
  /** Inclusive start, between 0 and the source string's length. */
  readonly from: number
  /** Exclusive end, at least `from`; equal endpoints represent an insertion. */
  readonly to: number
}

/**
 * Replace a range only while its source text matches the captured expectation.
 * Pass patches from the same source snapshot together to `applySourceEdits`;
 * callers must separately ensure that snapshot is still the intended revision.
 * The expected text guards a patch, not the identity of the surrounding task.
 *
 * @example
 * const edit: SourceEdit = {
 *   range: { from: 2, to: 5 }, expected: '[ ]', insert: '[x]',
 * }
 * applySourceEdits('+ [ ] milk', [edit]) // '+ [x] milk'
 * // Insert: use equal endpoints and expected: ''. Delete: use insert: ''.
 */
export interface SourceEdit {
  /** Range in the original source, before any other patch has been applied. */
  readonly range: SourceRange
  /** Exact original `source.slice(range.from, range.to)`; a mismatch throws. */
  readonly expected: string
  /** Replacement source, including any Markdown syntax and physical newlines. */
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

/**
 * A source operation on one scanned task. Later item blocks remain unchanged.
 * These requests describe intent; `planTaskSourceEdits` serializes them into
 * patches, and `applySourceEdits` applies those patches to the original source.
 *
 * @example
 * const task = scanTaskItems(source)[0]
 * if (task) {
 *   const edits = planTaskSourceEdits(source, task, {
 *     kind: 'replaceFirstParagraph', firstParagraphMarkdown: 'Buy **milk**',
 *   })
 *   const updated = applySourceEdits(source, edits)
 * }
 */
export type TaskSourceMutation =
  | {
      /** Set a checkbox explicitly; retrying does not toggle it back. */
      readonly kind: 'setChecked'
      /** Desired state; an already uppercase `[X]` remains uppercase when true. */
      readonly value: boolean
    }
  | {
      /** Replace the editable paragraph while retaining the checkbox. */
      readonly kind: 'replaceFirstParagraph'
      /**
       * Inline Markdown without bullet/checkbox/container prefixes. LF denotes
       * soft lines; blank pasted lines collapse and boundary newlines are removed.
       * For example, `"Buy **milk**\nfor lunch"` remains one task paragraph.
       */
      readonly firstParagraphMarkdown: string
    }
  | {
      /** Delete `firstParagraphRemoval`, leaving all later item blocks intact. */
      readonly kind: 'removeFirstParagraph'
    }
  | {
      /** Remove the checkbox, retaining an ordinary paragraph list item. */
      readonly kind: 'toBullet'
      /**
       * Optional simultaneous paragraph edit; omitted means retain the current
       * paragraph. Block-opening syntax is escaped so `"[ ] literal"` cannot
       * accidentally create another task after the checkbox is removed.
       */
      readonly firstParagraphMarkdown?: string
    }

/**
 * Recognize an exact three-character checkbox, without bullet or whitespace.
 * Returns its checked state, original `x`/`X` character (undefined if unchecked),
 * and exact marker text; returns undefined for other strings.
 *
 * @example
 * readTaskMarker('[X]') // { checked: true, character: 'X', text: '[X]' }
 */
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
 * An optional tree must have been parsed from exactly `source`; callers may
 * share their existing parse. Fenced code and ordinary unchecked lists are not
 * tasks. Application filters (for example only `+` bullets) belong to callers.
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
  const newline = source
    .slice(task.firstParagraphRemoval.from, task.firstParagraphRemoval.to)
    .includes('\r\n')
    ? '\r\n'
    : '\n'
  // Pasted blocks become soft lines. Empty boundary lines are not paragraph content.
  const content = (mutation.firstParagraphMarkdown ?? task.firstParagraphMarkdown)
    .replaceAll(/\r\n?/g, '\n')
    .replaceAll(/\n[ \t]*\n+/g, '\n')
    .replaceAll(/^\n+|\n+$/g, '')
  const lines = content.split('\n').map((line, index) => {
    if (index === 0) {
      if (mutation.kind !== 'toBullet') return line
      // Removing the checkbox exposes this text to block parsing. Escape only
      // a prefix that would change the ordinary bullet's paragraph semantics.
      const item = gfmParser.parse('+ ' + line).topNode.firstChild?.firstChild
      if (item?.firstChild?.nextSibling?.name === 'Paragraph') return line
      return line
        .replace(/^(\s*)([[#>+*<`~=-])/, String.raw`$1\$2`)
        .replace(/^(\s*\d+)([.)])(?=\s)/, String.raw`$1\$2`)
    }
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
  return mutation.kind === 'toBullet'
    ? edit({ from: task.marker.from, to: task.firstParagraph.to }, replacement)
    : edit({ from: task.marker.to, to: task.firstParagraph.to }, ' ' + replacement)
}

/**
 * A caller-selected insertion boundary. Heading/section selection remains the
 * caller's policy; this layer only writes list syntax at the chosen location.
 */
export type TaskInsertionTarget =
  | {
      /** Insert after the complete item, including its detail blocks. */
      readonly kind: 'afterItem'
      /** Item scanned from the same source; supplies `item.to` and `siblingPrefix`. */
      readonly item: TaskSourceItem
    }
  | {
      /** Insert at a caller-chosen source boundary, such as the end of a heading. */
      readonly kind: 'position'
      /**
       * UTF-16 position in the unchanged source. Choose a block boundary, not
       * the middle of a paragraph; insertion throws if it cannot create a task.
       */
      readonly offset: number
      /**
       * Container prefix and bullet, for example `"+ "` or `">   - "`.
       * Defaults to `"+ "`; must not contain physical newlines.
       */
      readonly prefix?: string
      /**
       * Separate a newly started list from surrounding prose with blank lines.
       * Defaults to false. Use true below a heading or between separate blocks.
       */
      readonly separate?: boolean
    }

/**
 * Initial content and placement of one new task. Defaults create an empty,
 * unchecked, top-level `+ [ ]` task at the end of the source.
 *
 * @example
 * const edit = planTaskInsertion(source, {
 *   firstParagraphMarkdown: 'Review **patch**', checked: false,
 * })
 * const updated = applySourceEdits(source, [edit])
 */
export interface TaskInsertionOptions {
  /**
   * Defaults to a top-level round task at the end of the supplied source.
   */
  readonly target?: TaskInsertionTarget
  /** Inline Markdown without checkbox/container prefixes; defaults to empty. */
  readonly firstParagraphMarkdown?: string
  /** Initial checkbox state; defaults to false, true writes lowercase `[x]`. */
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
