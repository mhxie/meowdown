import type { InlineContext, MarkdownConfig } from '@lezer/markdown'

import { hostFromUrl, isLinkableBareHost } from './autolink-tld.ts'
import {
  CHAR_0,
  CHAR_9,
  CHAR_ASTERISK,
  CHAR_CARRIAGE_RETURN,
  CHAR_HYPHEN_MINUS,
  CHAR_LEFT_PARENTHESIS,
  CHAR_LOWERCASE_A,
  CHAR_LOWERCASE_Z,
  CHAR_MAX_ASCII,
  CHAR_SPACE,
  CHAR_TAB,
  CHAR_TILDE,
  CHAR_UNDERSCORE,
  CHAR_UPPERCASE_A,
  CHAR_UPPERCASE_Z,
} from './unicode.ts'

// A domain (one or more labels, at least one dot) plus an optional path.
const DOMAIN_RE = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/[^\s<]*)?/i

const WHITESPACE_RE = /\s/

/**
 * Whether a bare autolink may start at `pos`: at the start of the inline text,
 * after whitespace, or after one of `( * _ ~`. Mirrors GFM's "start of line,
 * after whitespace, or one of these" boundary rule. A `.`, `-`, alphanumeric,
 * or `@` before the match means we are mid-word or mid-email, so no autolink
 * starts there.
 *
 * The autolink parsers ask this at every alphanumeric character, so it reads
 * the char code instead of slicing a string for a regex.
 */
export function isAutolinkBoundaryBefore(cx: InlineContext, pos: number): boolean {
  if (pos <= cx.offset) return true
  const code = cx.char(pos - 1)
  if (
    code === CHAR_LEFT_PARENTHESIS ||
    code === CHAR_ASTERISK ||
    code === CHAR_UNDERSCORE ||
    code === CHAR_TILDE
  ) {
    return true
  }
  // `\s` in ASCII: tab, line feed, vertical tab, form feed, carriage return, space.
  if (code <= CHAR_MAX_ASCII)
    return code === CHAR_SPACE || (code >= CHAR_TAB && code <= CHAR_CARRIAGE_RETURN)
  return WHITESPACE_RE.test(String.fromCharCode(code))
}

function isDomainStartChar(code: number): boolean {
  return (
    (code >= CHAR_0 && code <= CHAR_9) ||
    (code >= CHAR_UPPERCASE_A && code <= CHAR_UPPERCASE_Z) ||
    (code >= CHAR_LOWERCASE_A && code <= CHAR_LOWERCASE_Z) ||
    code === CHAR_HYPHEN_MINUS
  )
}

// Ported from https://code.haverbeke.berlin/lezer/markdown/src/commit/1.6.4/src/extension.ts#L173-L177
function countChar(text: string, end: number, ch: string): number {
  let count = 0
  for (let i = 0; i < end; i++) {
    if (text[i] === ch) count++
  }
  return count
}

// Trailing-punctuation trimming, so a bare domain ending a sentence
// drops the `.` / `,` / `)` etc. but keeps interior punctuation.
// Returns the kept length of `matched`.
//
// Ported from https://code.haverbeke.berlin/lezer/markdown/src/commit/1.6.4/src/extension.ts#L179-L195
export function trimAutolinkEnd(matched: string): number {
  let end = matched.length
  for (;;) {
    const last = matched[end - 1]
    if (
      /[?!.,:*_~]/.test(last) ||
      (last === ')' && countChar(matched, end, ')') > countChar(matched, end, '('))
    ) {
      end--
    } else if (last === ';') {
      const entity = /&(?:#\d+|#x[a-f\d]+|\w+);$/.exec(matched.slice(0, end))
      if (!entity) break
      end = entity.index
    } else {
      break
    }
  }
  return end
}

/**
 * Inline parser for a bare domain autolink such as `google.com` or
 * `sub.domain.io/path` (no scheme, no `www.`). It runs after GFM's own
 * `Autolink` so `www.`/scheme/email forms are claimed first and never reach
 * here. The domain must pass `isLinkableBareHost` (a curated TLD list plus
 * shape rules), which keeps `node.js`, `README.md`, and `i.e.` plain text. It
 * emits the shared `URL` node, so the existing mark walk renders it like any
 * other autolink.
 */
export const bareAutolink: MarkdownConfig = {
  parseInline: [
    {
      name: 'BareAutolink',
      before: 'Link',
      parse(cx, next, pos) {
        if (!isDomainStartChar(next) || !isAutolinkBoundaryBefore(cx, pos)) return -1

        const match = DOMAIN_RE.exec(cx.slice(pos, cx.end))
        if (!match) return -1

        const length = trimAutolinkEnd(match[0])
        if (length === 0) return -1

        const text = match[0].slice(0, length)
        if (!isLinkableBareHost(hostFromUrl(text))) return -1
        // Last: it scans every element parsed so far in the paragraph.
        if (cx.hasOpenLink) return -1

        return cx.addElement(cx.elt('URL', pos, pos + length))
      },
    },
  ],
}
