import {
  parseReferenceDefinition,
  referenceUses,
  serializeReferenceDefinition,
  type ReferenceDefinition,
  type ReferenceDefinitions,
} from '@meowdown/markdown'
import { definePlugin, Priority, union, withPriority, type PlainExtension } from '@prosekit/core'
import { Fragment, Slice, type ProseMirrorNode } from '@prosekit/pm/model'
import { Plugin, Selection } from '@prosekit/pm/state'
import { dropPoint } from '@prosekit/pm/transform'

import { collectReferenceDefinitions } from '../reference-links.ts'

export const REFERENCE_DATA = 'data-md-references'
const copiedDefinitions = new WeakMap<Fragment, ReferenceDefinition[]>()
export function copiedReferenceDefinitions(content: Fragment): ReferenceDefinition[] | undefined {
  return copiedDefinitions.get(content)
}

function referencedDefinitions(
  content: Fragment,
  definitions: ReferenceDefinitions,
): ReferenceDefinition[] {
  const keys = new Set<string>()
  content.descendants((node) => {
    if (node.type.spec.code) return false
    if (!node.isTextblock) return true
    for (const use of referenceUses(node.textContent)) keys.add(use.key)
    return false
  })
  return [...keys].flatMap((key) => (definitions.has(key) ? [definitions.get(key)!] : []))
}

/**
 * Source-flavor copy remains usable in a plain Markdown editor.
 */
export function clipboardMarkdownWithReferences(
  markdown: string,
  slice: Slice,
  doc: ProseMirrorNode,
): string {
  const selected = collectReferenceDefinitions(doc.type.create(null, slice.content)).definitions
  const missing = referencedDefinitions(
    slice.content,
    collectReferenceDefinitions(doc).definitions,
  ).filter((definition) => !selected.has(definition.key))
  return missing.length > 0
    ? `${markdown.trimEnd()}\n\n${missing.map(serializeReferenceDefinition).join('\n\n')}`
    : markdown
}

function clipboardDefinitions(html: string): ReferenceDefinition[] {
  if (!html.includes(REFERENCE_DATA)) return []
  const element = new DOMParser()
    .parseFromString(html, 'text/html')
    .querySelector(`[${CSS.escape(REFERENCE_DATA)}]`)
  const raw = element?.getAttribute(REFERENCE_DATA)
  if (!raw || raw.length > 100_000) return []
  try {
    const values: unknown = JSON.parse(raw)
    if (!Array.isArray(values)) return []
    return (values as unknown[]).filter((value): value is ReferenceDefinition => {
      if (
        value === null ||
        typeof value !== 'object' ||
        !('key' in value) ||
        !('href' in value) ||
        !('title' in value)
      )
        return false
      if (
        typeof value.key !== 'string' ||
        typeof value.href !== 'string' ||
        typeof value.title !== 'string'
      )
        return false
      if (!value.key || value.key.length >= 1_000 || /[\r\n]/.test(value.key + value.href))
        return false
      return (
        parseReferenceDefinition(
          serializeReferenceDefinition({ key: value.key, href: value.href, title: value.title }),
        )?.key === value.key
      )
    })
  } catch {
    return []
  }
}

export interface PreparedReferenceTransport {
  slice: Slice
  definitions: ProseMirrorNode[]
}

/**
 * Resolve incoming definitions before a caller inserts a clipboard or drag slice.
 */
export function prepareReferenceTransport(
  slice: Slice,
  doc: ProseMirrorNode,
  html = '',
): PreparedReferenceTransport | null {
  const selected = collectReferenceDefinitions(doc.type.create(null, slice.content))
  const incoming = new Map(
    clipboardDefinitions(html).map((definition) => [definition.key, definition]),
  )
  for (const [key, definition] of selected.definitions) incoming.set(key, definition)
  const used = referencedDefinitions(slice.content, incoming)
  if (used.length === 0) return null
  const existing = new Map(collectReferenceDefinitions(doc).definitions)
  const reserved = new Set([...existing.keys(), ...incoming.keys()])
  const renamed = new Map<string, string>()
  const added: ReferenceDefinition[] = []
  for (const definition of used) {
    let key = definition.key
    const target = existing.get(key)
    if (target && (target.href !== definition.href || target.title !== definition.title)) {
      let suffix = 2
      while (reserved.has(`${key}-${suffix}`)) suffix++
      key = `${key}-${suffix}`
    }
    renamed.set(definition.key, key)
    reserved.add(key)
    if (!existing.has(key)) {
      const next = { ...definition, key }
      existing.set(key, next)
      added.push(next)
    }
  }
  function rewrite(fragment: Fragment): Fragment {
    const nodes: ProseMirrorNode[] = []
    fragment.forEach((node) => {
      if (selected.nodes.has(node)) return
      if (node.type.spec.code) {
        nodes.push(node)
        return
      }
      if (node.isTextblock) {
        let text = node.textContent
        for (const use of referenceUses(text).reverse()) {
          const key = renamed.get(use.key)
          if (key && key !== use.key)
            text = text.slice(0, use.from) + `[${key}]` + text.slice(use.to)
        }
        nodes.push(
          text === node.textContent
            ? node
            : node.copy(text ? Fragment.from(node.type.schema.text(text)) : Fragment.empty),
        )
      } else nodes.push(node.childCount ? node.copy(rewrite(node.content)) : node)
    })
    return Fragment.from(nodes)
  }
  const content = rewrite(slice.content)
  const open = Slice.maxOpen(content)
  return {
    slice: new Slice(
      content,
      Math.min(slice.openStart, open.openStart),
      Math.min(slice.openEnd, open.openEnd),
    ),
    definitions: added.map((definition) => {
      return doc.type.schema.nodes.paragraph.create(
        null,
        doc.type.schema.text(serializeReferenceDefinition(definition)),
      )
    }),
  }
}

/**
 * Carry only cited definitions, preserving destination and locator title through collisions.
 */
export function defineReferenceClipboard(): PlainExtension {
  const copied = withPriority(
    definePlugin(
      new Plugin({
        props: {
          transformCopied(slice, view) {
            const definitions = referencedDefinitions(
              slice.content,
              collectReferenceDefinitions(view.state.doc).definitions,
            )
            function remember(content: Fragment) {
              copiedDefinitions.set(content, definitions)
              content.forEach((node) => {
                if (node.childCount) remember(node.content)
              })
            }
            remember(slice.content)
            return slice
          },
        },
      }),
    ),
    Priority.lowest,
  )
  const pasted = definePlugin(
    new Plugin({
      props: {
        handlePaste(view, event, slice) {
          const prepared = prepareReferenceTransport(
            slice,
            view.state.doc,
            event.clipboardData?.getData('text/html'),
          )
          if (!prepared) return false
          const tr = view.state.tr.replaceSelection(prepared.slice)
          if (prepared.definitions.length > 0) tr.insert(tr.doc.content.size, prepared.definitions)
          view.dispatch(tr.setMeta('paste', true).setMeta('uiEvent', 'paste').scrollIntoView())
          return true
        },
        handleDrop(view, event, slice, moved) {
          // Same-document moves already share the source definitions and selection semantics.
          if (moved) return false
          const prepared = prepareReferenceTransport(
            slice,
            view.state.doc,
            event.dataTransfer?.getData('text/html'),
          )
          if (!prepared) return false
          const coords = view.posAtCoords({ left: event.clientX, top: event.clientY })
          if (!coords) return false
          const pos = dropPoint(view.state.doc, coords.pos, prepared.slice) ?? coords.pos
          const tr = view.state.tr.replaceRange(pos, pos, prepared.slice)
          if (tr.doc.eq(view.state.doc)) return false
          tr.setSelection(Selection.near(tr.doc.resolve(tr.mapping.map(pos, 1)), -1))
          if (prepared.definitions.length > 0) tr.insert(tr.doc.content.size, prepared.definitions)
          view.focus()
          view.dispatch(tr.setMeta('uiEvent', 'drop').scrollIntoView())
          return true
        },
      },
    }),
  )
  return union(copied, pasted)
}
