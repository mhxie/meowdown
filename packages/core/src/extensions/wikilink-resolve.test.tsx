import { TextSelection } from '@prosekit/pm/state'
import { describe, expect, it, vi } from 'vitest'
import { page, userEvent } from 'vitest/browser'

import { docToMarkdown } from '../converters/pm-to-md.ts'
import { resolveWikilinkAlias, setupFixture, type Fixture } from '../testing/index.ts'
import { getTextblockDisplayText } from '../utils/display-text.ts'

import { updateEditorConfig } from './editor-config.ts'
import { formatMagicComment } from './magic-comment.ts'
import type { MarkMode } from './mark-mode.ts'
import type { WikilinkClickHandler } from './wikilink-click.ts'
import type { WikilinkResolver } from './wikilink.ts'

const pmRoot = page.locate('.ProseMirror')
const label = pmRoot.getByTestId('wikilink')

// Splits `|` like a host would, then shows only the first ` // ` segment of a
// target that has no alias.
const resolveSubject: WikilinkResolver = (link) => {
  const alias = resolveWikilinkAlias(link)
  if (alias) return alias
  const [first] = link.target.split(' // ')
  return first === link.target ? undefined : { display: first }
}

function setup(
  markdown: string,
  options: { resolveWikilink?: WikilinkResolver } = { resolveWikilink: resolveSubject },
): Fixture {
  const fixture = setupFixture({ extensionOptions: { markMode: 'hide', ...options } })
  const { n } = fixture
  fixture.set(n.doc(n.paragraph(markdown)))
  return fixture
}

describe('wikilink resolver', () => {
  it('keeps a multiline metadata comment visible and outside the wikilink atom', async () => {
    const source = '[[Note|ref]]<!-- {"metadata":\n{"citation":{"valid_at":"2026-10-06"}}} -->'
    const resolveWikilink = vi.fn<WikilinkResolver>(({ metadata }) => ({
      target: 'Note',
      display: 'ref',
      appearance: metadata ? 'reference' : undefined,
    }))
    using fixture = setup(source, { resolveWikilink })
    expect(resolveWikilink).toHaveBeenCalledWith({ target: 'Note|ref' })
    await expect.element(label).not.toHaveClass('meowdown-reference')
    expect(fixture.view.dom.innerText).toContain('"valid_at":"2026-10-06"')
    expect(fixture.doc.textContent).toBe(source)
  })

  it.each(['hide', 'focus', 'show'] satisfies MarkMode[])(
    'edits reference metadata in %s mode with Alt+Enter and supports undo',
    async (markMode) => {
      const source =
        '[[Note|ref]]<!-- {"metadata":{"citation":{"valid_at":"2026-10-06","invalid_at":"2026-10-07"}}} -->'
      using fixture = setup(source, {
        resolveWikilink: () => ({ target: 'Note', display: 'Note', appearance: 'reference' }),
      })
      updateEditorConfig(fixture.editor, { markMode })
      await expect.element(label).toHaveAttribute('title', expect.stringContaining('Alt+Enter'))
      label.element().focus()
      await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
      await expect.element(label).not.toBeVisible()
      const content = pmRoot.locate('.md-wikilink-view-content')
      expect(getComputedStyle(content.element()).fontSize).not.toBe('0px')
      const start = source.indexOf('2026-10-07') + 1
      fixture.view.dispatch(
        fixture.view.state.tr.setSelection(TextSelection.create(fixture.doc, start, start + 10)),
      )
      await userEvent.keyboard('2026-10-08')
      expect(docToMarkdown(fixture.doc)).toBe(`${source.replace('2026-10-07', '2026-10-08')}\n`)
      expect(fixture.editor.commands.undo()).toBe(true)
      expect(docToMarkdown(fixture.doc)).toBe(`${source}\n`)
      await userEvent.keyboard('{Escape}')
      await expect.element(label).toBeVisible()
    },
  )

  it('opens reference source with Alt-click without navigating, and folds it when leaving', async () => {
    const source = '[[Note|ref]]<!-- {"metadata":{"source":true}} --> tail'
    using fixture = setup(source, {
      resolveWikilink: () => ({ target: 'Note', appearance: 'reference' }),
    })
    const onWikilinkClick = vi.fn<WikilinkClickHandler>()
    updateEditorConfig(fixture.editor, { onWikilinkClick })
    await userEvent.keyboard('{Alt>}')
    await label.click()
    await userEvent.keyboard('{/Alt}')
    await expect.element(label).not.toBeVisible()
    expect(onWikilinkClick).not.toHaveBeenCalled()
    fixture.view.dispatch(
      fixture.view.state.tr.setSelection(TextSelection.create(fixture.doc, source.length + 1)),
    )
    await expect.element(label).toBeVisible()
    expect(docToMarkdown(fixture.doc)).toBe(`${source}\n`)
  })

  it('opens an arrow-selected reference with Alt+Enter', async () => {
    const source = '[[Note|ref]]<!-- {"metadata":{"source":true}} -->'
    using fixture = setup(source, {
      resolveWikilink: () => ({ target: 'Note', appearance: 'reference' }),
    })
    fixture.view.dispatch(
      fixture.view.state.tr.setSelection(TextSelection.create(fixture.doc, 1, source.length + 1)),
    )
    fixture.view.focus()
    await userEvent.keyboard('{Alt>}{Enter}{/Alt}')
    await expect.element(label).not.toBeVisible()
    expect(fixture.view.state.selection.from).toBe(3)
  })

  it('leaves an Alt-click outside a reference alone while a reference is selected', async () => {
    const source = '[[Note|ref]]<!-- {"metadata":{"source":true}} --> tail'
    using fixture = setup(source, {
      resolveWikilink: () => ({ target: 'Note', appearance: 'reference' }),
    })
    const end = source.indexOf(' tail') + 1
    fixture.view.dispatch(
      fixture.view.state.tr.setSelection(TextSelection.create(fixture.doc, 1, end)),
    )
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, altKey: true })
    fixture.view.dom.querySelector('p')!.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    await expect.element(label).toBeVisible()
    expect(fixture.view.state.selection.from).toBe(1)
  })

  it('renders reference metadata without rewriting source and follows its target', async () => {
    const metadata = { citation: { valid_at: '2026-10-06', details: 'a -- b' } }
    const source = `Claim [[Note#^c2|ref]]${formatMagicComment({ metadata })}`
    const resolveWikilink = vi.fn<WikilinkResolver>(() => ({
      target: 'Note#^c2',
      display: 'Note, claim 2',
      appearance: 'reference',
      description: 'Evidence recorded 2026-10-06',
    }))
    using fixture = setup(source, { resolveWikilink })
    const onWikilinkClick = vi.fn<WikilinkClickHandler>()
    updateEditorConfig(fixture.editor, { onWikilinkClick })
    expect(resolveWikilink).toHaveBeenCalledWith({ target: 'Note#^c2|ref', metadata })
    await expect.element(label).toHaveClass('meowdown-reference')
    await expect.element(label).toHaveAccessibleName('Note, claim 2')
    await expect.element(label).toHaveAttribute('aria-description', 'Evidence recorded 2026-10-06')
    await label.click()
    expect(onWikilinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note#^c2' }))
    expect(docToMarkdown(fixture.doc)).toBe(`${source}\n`)
  })

  it('activates a focused reference using Enter', async () => {
    using fixture = setup('[[Note|ref]]<!-- {"metadata":{"source":true}} -->', {
      resolveWikilink: () => ({ target: 'Note', appearance: 'reference' }),
    })
    const onWikilinkClick = vi.fn<WikilinkClickHandler>()
    updateEditorConfig(fixture.editor, { onWikilinkClick })
    label.element().focus()
    await userEvent.keyboard('{Enter}')
    expect(onWikilinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note' }))
  })

  it('uses the bracketed text as the label and the target without a resolver', async () => {
    const onWikilinkClick = vi.fn<WikilinkClickHandler>()
    using fixture = setup('[[Note|My Note]]', {})
    updateEditorConfig(fixture.editor, { onWikilinkClick })
    await expect.element(label).toHaveTextContent('Note|My Note')
    await userEvent.click(label)
    expect(onWikilinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'Note|My Note' }),
    )
  })

  it('renders the resolved display as the label', async () => {
    using fixture = setup('see [[Tim MacCaw // Dad]] here')
    void fixture
    await expect.element(label).toHaveTextContent('Tim MacCaw')
  })

  it('reports the resolved target on click', async () => {
    const onWikilinkClick = vi.fn<WikilinkClickHandler>()
    using fixture = setup('[[Tim MacCaw // Dad|Dad]]')
    updateEditorConfig(fixture.editor, { onWikilinkClick })
    await expect.element(label).toHaveTextContent('Dad')
    await userEvent.click(label)
    expect(onWikilinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'Tim MacCaw // Dad' }),
    )
  })

  it('feeds the resolved display into the display text', () => {
    using fixture = setup('see [[Tim MacCaw // Dad]] and [[Note|My Note]]')
    expect(getTextblockDisplayText(fixture.doc.child(0))).toBe('see Tim MacCaw and My Note')
  })

  it('leaves the Markdown source untouched', () => {
    using fixture = setup('see [[Tim MacCaw // Dad|Dad]] here')
    expect(fixture.doc.textContent).toBe('see [[Tim MacCaw // Dad|Dad]] here')
    expect(docToMarkdown(fixture.doc)).toBe('see [[Tim MacCaw // Dad|Dad]] here\n')
  })
})
