import { parseReferenceDefinition, serializeReferenceDefinition } from '@meowdown/markdown'
import { createTestEditor, pasteHTML } from '@prosekit/core/test'
import { describe, expect, it } from 'vitest'

import { markdownToDoc } from '../../converters/md-to-pm.ts'
import { docToMarkdown } from '../../converters/pm-to-md.ts'
import { setupFixture } from '../../testing/index.ts'
import { defineEditorExtension } from '../extension.ts'
import { collectReferenceDefinitions } from '../reference-links.ts'

import { prepareReferenceTransport } from './reference-transport.ts'

const source =
  'A [ref][x] and [ref][y], with `[literal][z]`.\n\n[x]: https://example.org/paper "p. 12"\n\n[y]: https://example.org/paper "p. 14"\n\n[z]: https://example.org/literal'

describe('reference clipboard transport', () => {
  it('round-trips literal entities in URLs and locator titles', () => {
    const definition = parseReferenceDefinition(
      '[x]: <https://example.org/?q=&amp;copy;> "literal &amp;copy;"',
    )!
    expect(parseReferenceDefinition(serializeReferenceDefinition(definition))).toEqual(definition)
  })

  it('transports an image reference nested inside a link', () => {
    using fixture = setupFixture()
    fixture.set(
      markdownToDoc(
        '[![alt][image]][outer]\n\n[image]: https://example.org/image.png\n\n[outer]: https://example.org/page',
        { nodes: fixture.editor.nodes },
      ),
    )
    const doc = fixture.view.state.doc
    const html = fixture.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize)).dom
    const defs = JSON.parse(html.firstElementChild!.getAttribute('data-md-references')!) as Array<{
      key: string
    }>
    expect(defs.map((d: { key: string }) => d.key).sort()).toEqual(['IMAGE', 'OUTER'])
  })

  it('uses each source document when two editors share one extension', () => {
    const extension = defineEditorExtension()
    const a = createTestEditor({ extension })
    const b = createTestEditor({ extension })
    const containers = [document.createElement('div'), document.createElement('div')]
    for (const node of containers) document.body.append(node)
    a.mount(containers[0])
    b.mount(containers[1])
    try {
      for (const [editor, name] of [
        [a, 'a'],
        [b, 'b'],
      ] as const) {
        editor.set(
          markdownToDoc(`[ref][x]\n\n[x]: https://example.org/${name} "${name}"`, {
            nodes: editor.nodes,
          }),
        )
      }
      for (const [editor, name] of [
        [a, 'a'],
        [b, 'b'],
        [a, 'a'],
      ] as const) {
        const doc = editor.view.state.doc
        const html = editor.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize)).dom
        expect(
          (
            JSON.parse(html.firstElementChild!.getAttribute('data-md-references')!) as Array<{
              href: string
            }>
          )[0].href,
        ).toBe(`https://example.org/${name}`)
      }
    } finally {
      a.unmount()
      b.unmount()
      for (const node of containers) node.remove()
    }
  })

  it('copies only used definitions in HTML and Markdown source', () => {
    using fixture = setupFixture({ extensionOptions: { markMode: 'show' } })
    fixture.set(markdownToDoc(source, { nodes: fixture.editor.nodes }))
    const doc = fixture.view.state.doc
    const copied = fixture.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize))
    const definitions = JSON.parse(
      copied.dom.firstElementChild!.getAttribute('data-md-references')!,
    ) as Array<{ key: string }>
    expect(definitions.map((definition: { key: string }) => definition.key)).toEqual(['X', 'Y'])
    expect(copied.text).toContain('[X]: <https://example.org/paper> "p. 12"')
    expect(copied.text).toContain('[Y]: <https://example.org/paper> "p. 14"')
    expect(copied.text).not.toContain('[Z]:')
  })

  it('renames a conflicting label while preserving occurrence locators and one-step undo', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(markdownToDoc(source, { nodes: from.editor.nodes }))
    const doc = from.view.state.doc
    const html = from.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize)).dom
      .innerHTML
    using to = setupFixture({ containerId: 'target' })
    to.set(
      markdownToDoc('Destination.\n\n[x]: https://example.org/other "existing"', {
        nodes: to.editor.nodes,
      }),
    )
    const before = docToMarkdown(to.view.state.doc)
    pasteHTML(to.view, html)
    const after = docToMarkdown(to.view.state.doc)
    expect(after).toContain('[ref][X-2]')
    const defs = collectReferenceDefinitions(to.view.state.doc).definitions
    expect(defs.get('X')).toMatchObject({ href: 'https://example.org/other', title: 'existing' })
    expect(defs.get('X-2')).toMatchObject({ href: 'https://example.org/paper', title: 'p. 12' })
    expect(defs.get('Y')).toMatchObject({ href: 'https://example.org/paper', title: 'p. 14' })
    to.editor.commands.undo()
    expect(docToMarkdown(to.view.state.doc)).toBe(before)
  })

  it('reuses an identical definition and keeps shortcut labels readable', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(
      markdownToDoc('[x] and [x][].\n\n[x]: https://example.org/paper "p. 12"', {
        nodes: from.editor.nodes,
      }),
    )
    const doc = from.view.state.doc
    const html = from.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize)).dom
      .innerHTML
    using to = setupFixture({ containerId: 'target' })
    to.set(
      markdownToDoc('Destination.\n\n[x]: https://example.org/paper "p. 12"', {
        nodes: to.editor.nodes,
      }),
    )
    pasteHTML(to.view, html)
    expect(collectReferenceDefinitions(to.view.state.doc).definitions.size).toBe(1)
    expect(docToMarkdown(to.view.state.doc)).toContain('[x] and [x][].')
  })

  it('carries definitions through a drop and preserves a same-URL locator collision', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(markdownToDoc(source, { nodes: from.editor.nodes }))
    const doc = from.view.state.doc
    const copied = from.view.serializeForClipboard(doc.slice(0, doc.firstChild!.nodeSize))
    using to = setupFixture({ containerId: 'target' })
    to.set(
      markdownToDoc('Destination.\n\n[x]: https://example.org/paper "p. 2"', {
        nodes: to.editor.nodes,
      }),
    )
    const before = docToMarkdown(to.view.state.doc)
    const dataTransfer = new DataTransfer()
    dataTransfer.setData('text/html', copied.dom.innerHTML)
    dataTransfer.setData('text/plain', copied.text)
    const coords = to.view.coordsAtPos(1)
    const event = new DragEvent('drop', {
      bubbles: true,
      cancelable: true,
      dataTransfer,
      clientX: coords.left + 1,
      clientY: (coords.top + coords.bottom) / 2,
    })
    to.view.dom.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(docToMarkdown(to.view.state.doc)).toContain('[ref][X-2]')
    const definitions = collectReferenceDefinitions(to.view.state.doc).definitions
    expect(definitions.get('X')?.title).toBe('p. 2')
    expect(definitions.get('X-2')?.title).toBe('p. 12')
    expect(definitions.get('Y')?.title).toBe('p. 14')
    to.editor.commands.undo()
    expect(docToMarkdown(to.view.state.doc)).toBe(before)
  })

  it('carries an uncited definition that was part of the selection', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(
      markdownToDoc('See [a][x].\n\n[x]: https://a\n\n[y]: https://b', {
        nodes: from.editor.nodes,
      }),
    )
    const doc = from.view.state.doc
    const html = from.view.serializeForClipboard(doc.slice(0, doc.content.size)).dom.innerHTML
    using to = setupFixture({ containerId: 'target' })
    to.set(markdownToDoc('Destination.', { nodes: to.editor.nodes }))
    pasteHTML(to.view, html)
    const definitions = collectReferenceDefinitions(to.view.state.doc).definitions
    expect(definitions.get('X')?.href).toBe('https://a')
    expect(definitions.get('Y')?.href).toBe('https://b')
  })

  it('omits a container left empty by a moved definition', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(markdownToDoc('See [a][x].\n\n> [x]: https://a', { nodes: from.editor.nodes }))
    const doc = from.view.state.doc
    using to = setupFixture({ containerId: 'target' })
    to.set(markdownToDoc('Destination.', { nodes: to.editor.nodes }))
    const prepared = prepareReferenceTransport(doc.slice(0, doc.content.size), to.view.state.doc)
    expect(prepared?.slice.content.childCount).toBe(1)
    expect(prepared?.slice.content.firstChild?.textContent).toBe('See [a][x].')
    expect(prepared?.definitions.map((node) => node.textContent)).toEqual(['[X]: <https://a>'])
  })

  it('prefers the copied definition over one cut off at the edge of the selection', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(
      markdownToDoc('See [a][x].\n\n[x]: https://example.org/full', {
        nodes: from.editor.nodes,
      }),
    )
    const doc = from.view.state.doc
    const end = doc.content.size - '/full'.length - 1
    const html = from.view.serializeForClipboard(doc.slice(0, end)).dom.innerHTML
    using to = setupFixture({ containerId: 'target' })
    to.set(markdownToDoc('Destination.', { nodes: to.editor.nodes }))
    pasteHTML(to.view, html)
    expect(collectReferenceDefinitions(to.view.state.doc).definitions.get('X')?.href).toBe(
      'https://example.org/full',
    )
  })

  it('leaves default paste alone when nothing needs to be rewritten', () => {
    using from = setupFixture({ containerId: 'source' })
    from.set(
      markdownToDoc('See [a][x].\n\n[x]: https://a', {
        nodes: from.editor.nodes,
      }),
    )
    const doc = from.view.state.doc
    const cited = doc.slice(0, doc.firstChild!.nodeSize)
    const html = from.view.serializeForClipboard(cited).dom.innerHTML
    using to = setupFixture({ containerId: 'target' })
    to.set(markdownToDoc('Destination.\n\n[x]: https://a', { nodes: to.editor.nodes }))
    expect(prepareReferenceTransport(cited, to.view.state.doc, html)).toBeNull()
  })
})
