import type { TreeCursor } from '@lezer/common'

import { LEZER_NODE_IDS } from './node-ids.ts'
import { CHAR_TAB, CHAR_SPACE, CHAR_LINE_FEED } from './unicode.ts'

/**
 * The column at which content begins on the line containing `from` (i.e. the
 * enclosing container's content column). Columns count a tab as a CommonMark
 * tab stop of 4 (`4 - col % 4`), matching how lezer measures indentation.
 */
export function measureContentColumn(text: string, from: number): number {
  const lineStart = text.lastIndexOf('\n', from - 1) + 1
  let col = 0
  for (let index = lineStart; index < from; index++) {
    col += text.charCodeAt(index) === CHAR_TAB ? 4 - (col % 4) : 1
  }
  return col
}

/**
 * Drop a line's leading whitespace up to `column`, counting a tab as `4 - col % 4`
 * columns. Whitespace the container never wrote is left alone: a tab that would
 * reach past `column` stands for more columns than the container takes, and a
 * line whose indentation stops short of `column` was written lazily, without any
 * prefix at all.
 */
export function sliceColumn(line: string, column: number): string {
  let col = 0
  let index = 0
  while (col < column) {
    const code = line.charCodeAt(index)
    if (code === CHAR_SPACE) {
      col += 1
    } else if (code === CHAR_TAB) {
      const width = 4 - (col % 4)
      if (col + width > column) break
      col += width
    } else {
      // The line stops short of `column`, so it never carried the container's
      // prefix: it is a lazy continuation, and every column it has is its own.
      return line
    }
    index++
  }
  return line.slice(index)
}

/**
 * Strip a leaf block's structural continuation indent.
 *
 * lezer keeps the indent of a multi-line block's continuation lines inside the
 * source span (its `scrub` pads each line's container prefix to equal-width
 * whitespace to preserve positions). CommonMark and lezer require every
 * continuation line to be indented to the same content `column`, which equals
 * the block's first-line column. The first line is already past its indent, so
 * only lines 2..n are dedented. Returns `content` untouched at column 0 (a
 * top-level block) or when there is no continuation line.
 */
export function dedentContinuation(content: string, column: number): string {
  if (column === 0 || !content.includes('\n')) return content
  return content
    .split('\n')
    .map((line, index) => (index === 0 ? line : sliceColumn(line, column)))
    .join('\n')
}

/**
 * The blockquote markers inside `from`..`to`, as a flat run of `from, to` pairs
 * in document order. A marker can sit at any depth: a paragraph carries its own,
 * while a link reference's lands inside the `LinkLabel` that spans the break.
 * The cursor ends where it started.
 */
function collectQuoteMarks(cursor: TreeCursor, marks: number[], from: number, to: number): void {
  if (!cursor.firstChild()) return
  do {
    if (cursor.from >= to) break
    if (cursor.to <= from) continue
    if (cursor.type.id === LEZER_NODE_IDS.QuoteMark) {
      marks.push(cursor.from, cursor.to)
      continue
    }
    collectQuoteMarks(cursor, marks, from, to)
  } while (cursor.nextSibling())
  cursor.parent()
}

/**
 * The source between `from` and `to`, minus the blockquote markers inside it.
 *
 * In block-only parsing a leaf block has no inline children, with one
 * exception: lezer leaves the `QuoteMark` of every continuation line of a
 * multi-line block (`> l1\n> l2`) inside the block's own span. A marker takes
 * the whole line prefix with it, the single space after it included, exactly as
 * the serializer's own prefix puts it back. Only a space: a tab after the marker
 * stands for the columns up to the next tab stop, more than the prefix writes
 * back, so it stays in the text as the indentation it is. A line with no marker
 * carried no prefix at all - it is a lazy continuation, and every column on it
 * is its own. Markers outside `from`..`to` (an ATX heading's own marks, a setext
 * underline's line) are left alone. The cursor ends where it started.
 */
export function readLeafText(cursor: TreeCursor, text: string, from: number, to: number): string {
  // Only a block that spans a line break can carry a marker inside it, or end on
  // a line that is not its last.
  const lineBreak = text.indexOf('\n', from)
  if (lineBreak < 0 || lineBreak >= to) return text.slice(from, to)

  const marks: number[] = []
  collectQuoteMarks(cursor, marks, from, to)
  let content = ''
  let pos = from
  for (let index = 0; index < marks.length; index += 2) {
    // Everything from the start of the marker's line up to the marker is the
    // indent the enclosing containers wrote, which the serializer writes back
    // as its own line prefix. A second marker on the same line (`> > a`) starts
    // behind `pos`, and the text between two markers is theirs alone.
    content += text.slice(pos, Math.max(pos, text.lastIndexOf('\n', marks[index]) + 1))
    pos = marks[index + 1]
    if (text.charCodeAt(pos) === CHAR_SPACE) pos += 1
  }
  return trimTrailingBlankLines(content + text.slice(pos, to))
}

/**
 * Drop the blank lines a block ends with, the line break in front of them
 * included. A raw HTML or processing-instruction block with no closing sequence
 * runs its span to the end of the document and swallows them; a leaf block's
 * text ends where its last line does, which is where the serializer ends its
 * own output (`MdOut.finish`), so recording more would lose it on the way back.
 */
function trimTrailingBlankLines(content: string): string {
  let end = content.length
  for (let index = end - 1; index >= 0; index--) {
    const code = content.charCodeAt(index)
    if (code === CHAR_LINE_FEED) end = index
    else if (code !== CHAR_SPACE && code !== CHAR_TAB) break
  }
  return content.slice(0, end)
}
