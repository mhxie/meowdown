import { decodeString } from 'micromark-util-decode-string'
import { normalizeIdentifier } from 'micromark-util-normalize-identifier'

import { parseInline, type InlineElement } from './inline.ts'
import { LEZER_NODE_IDS } from './node-ids.ts'
import { gfmParser } from './parser.ts'

export interface ReferenceDefinition {
  key: string
  href: string
  title: string
}

export type ReferenceDefinitions = ReadonlyMap<string, ReferenceDefinition>

export interface ReferenceUse {
  key: string
  /**
   * Full explicit label, or an empty range after a shortcut's closing bracket.
   */
  from: number
  to: number
}

/**
 * Reference labels in inline prose; code, escapes, and inline destinations are excluded.
 */
export function referenceUses(text: string): ReferenceUse[] {
  const uses: ReferenceUse[] = []
  function visit(nodes: readonly InlineElement[]) {
    for (const node of nodes) {
      if (node.type === LEZER_NODE_IDS.Link || node.type === LEZER_NODE_IDS.Image) {
        const marks = node.children.filter((child) => child.type === LEZER_NODE_IDS.LinkMark)
        if (marks.length !== 2) {
          visit(node.children)
          continue
        }
        const label = node.children.find((child) => child.type === LEZER_NODE_IDS.LinkLabel)
        const visible = text.slice(marks[0].to, marks[1].from)
        const key = normalizeReferenceLabel(
          label ? text.slice(label.from + 1, label.to - 1) || visible : visible,
        )
        if (key) uses.push({ key, from: label?.from ?? node.to, to: label?.to ?? node.to })
        visit(node.children)
      } else {
        visit(node.children)
      }
    }
  }
  visit(parseInline(text))
  return uses.sort((a, b) => a.from - b.from)
}

export function serializeReferenceDefinition(definition: ReferenceDefinition): string {
  const escape = (text: string) => {
    return text.replaceAll(/[\\"<>[\]&]/g, String.raw`\$&`).replaceAll(/\r?\n/g, ' ')
  }
  return `[${definition.key}]: <${escape(definition.href)}> ${definition.title ? `"${escape(definition.title)}"` : ''}`.trimEnd()
}

/**
 * CommonMark's case and whitespace normalization for a reference label.
 */
export function normalizeReferenceLabel(label: string): string {
  return normalizeIdentifier(label)
}

/**
 * A bounded candidate check shared by parsers and incremental editor invalidation.
 */
export function mayBeReferenceDefinition(text: string): boolean {
  if (text.length > 1_024) return false
  const first = text.search(/\S/)
  return first >= 0 && text.charCodeAt(first) === 91 && text.includes(']:', first + 1)
}

/**
 * Parse one complete definition, decoding escaped destinations and occurrence titles.
 */
export function parseReferenceDefinition(text: string): ReferenceDefinition | undefined {
  if (!mayBeReferenceDefinition(text)) return
  const reference = gfmParser.parse(text).topNode.firstChild
  if (reference?.type.id !== LEZER_NODE_IDS.LinkReference || reference.nextSibling != null) return
  const label = reference.getChild('LinkLabel')
  const destination = reference.getChild('URL')
  if (label == null || destination == null) return
  const key = normalizeReferenceLabel(text.slice(label.from + 1, label.to - 1))
  if (key === '') return
  const raw = text.slice(destination.from, destination.to)
  const title = reference.getChild('LinkTitle')
  return {
    key,
    href: decodeString(raw.startsWith('<') && raw.endsWith('>') ? raw.slice(1, -1) : raw),
    title: title == null ? '' : decodeString(text.slice(title.from + 1, title.to - 1)),
  }
}
