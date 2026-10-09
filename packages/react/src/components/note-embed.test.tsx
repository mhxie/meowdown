import '../testing/index.ts'

import { readClipboard } from '@meowdown/vitest/clipboard'
import { createContext, createRef, use, useEffect, useState, type ReactElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { MarkdownEditor } from './editor.tsx'
import { MarkdownView } from './markdown-view.tsx'
import type { NoteEmbedPayload } from './note-embed.ts'
import type { EditorHandle } from './types.ts'

const ReaderContext = createContext('missing provider')
const resolveWikiEmbed = () => ({ kind: 'note' as const })

function Reader({ target, display }: NoteEmbedPayload): ReactElement {
  const [expanded, setExpanded] = useState(false)
  const context = use(ReaderContext)
  return (
    <div data-testid="reader">
      <button type="button" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
        {display || target}
      </button>
      {expanded ? (
        <div>
          <h2>{context}</h2>
          <p>Original body</p>
        </div>
      ) : null}
    </div>
  )
}

const renderNoteEmbed = (payload: NoteEmbedPayload) => <Reader {...payload} />

describe('host note embeds', () => {
  it('keeps the original source and ordinary paragraph DOM while rendering through host providers', async () => {
    const editor = createRef<EditorHandle>()
    const source = 'Before\n\n![[Original|Read original]]\n\nAfter'
    await render(
      <ReaderContext value="Host provider">
        <MarkdownEditor
          initialMarkdown={source}
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderNoteEmbed}
          handleRef={editor}
        />
      </ReaderContext>,
    )
    const button = page.getByRole('button', { name: 'Read original', exact: true })
    await expect.element(button).toBeInTheDocument()
    await button.click()
    await expect.element(page.getByRole('heading', { name: 'Host provider' })).toBeInTheDocument()
    expect(editor.current?.getMarkdown()).toBe(`${source}\n`)
    const root = page.locate('.ProseMirror').element()
    expect(root.children[0].tagName).toBe('P')
    expect(root.children[1].tagName).toBe('DIV')
    expect(root.children[2].tagName).toBe('P')
    expect(root.querySelector('p .md-note-embed-reader')).toBeNull()
  })

  it('lets keyboard controls expand without editing the enclosing note or following its link', async () => {
    const editor = createRef<EditorHandle>()
    const onDocChange = vi.fn()
    const onWikilinkClick = vi.fn()
    await render(
      <MarkdownEditor
        initialMarkdown="![[Original]]"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={renderNoteEmbed}
        onDocChange={onDocChange}
        onWikilinkClick={onWikilinkClick}
        handleRef={editor}
      />,
    )
    const button = page.getByRole('button', { name: 'Original', exact: true })
    await expect.element(button).toBeInTheDocument()
    button.element().focus()
    await userEvent.keyboard('{Enter}')
    await expect.element(button).toHaveAttribute('aria-expanded', 'true')
    expect(editor.current?.getMarkdown()).toBe('![[Original]]\n')
    expect(onDocChange).not.toHaveBeenCalled()
    expect(onWikilinkClick).not.toHaveBeenCalled()
  })

  it('rebuilds DOM when a paragraph changes between ordinary text and an embed', async () => {
    const editor = createRef<EditorHandle>()
    await render(
      <MarkdownEditor
        initialMarkdown="Ordinary"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={renderNoteEmbed}
        handleRef={editor}
      />,
    )
    editor.current?.setMarkdown('![[Original]]')
    await expect.element(page.getByTestId('reader')).toBeInTheDocument()
    expect(page.locate('.ProseMirror').element().firstElementChild?.tagName).toBe('DIV')
    editor.current?.setMarkdown('Ordinary again')
    await expect.element(page.getByTestId('reader')).not.toBeInTheDocument()
    expect(page.locate('.ProseMirror').element().firstElementChild?.tagName).toBe('P')
    expect(editor.current?.getMarkdown()).toBe('Ordinary again\n')
  })

  it('copies a DOM selection in the reader body without selecting or editing the source reference', async () => {
    const editor = createRef<EditorHandle>()
    const onDocChange = vi.fn()
    await render(
      <MarkdownEditor
        initialMarkdown="![[Original]]"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={renderNoteEmbed}
        onDocChange={onDocChange}
        handleRef={editor}
      />,
    )
    await page.getByRole('button', { name: 'Original', exact: true }).click()
    const body = page.getByText('Original body').element()
    document.getSelection()?.selectAllChildren(body)
    expect(document.getSelection()?.toString()).toBe('Original body')
    await userEvent.copy()
    expect((await readClipboard()).text).toBe('Original body')
    expect(editor.current?.getMarkdown()).toBe('![[Original]]\n')
    expect(onDocChange).not.toHaveBeenCalled()
    document.getSelection()?.removeAllRanges()
  })

  it('lets the enclosing editor select and delete the source reference with the keyboard', async () => {
    const editor = createRef<EditorHandle>()
    await render(
      <MarkdownEditor
        initialMarkdown="![[Original]]"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={renderNoteEmbed}
        handleRef={editor}
      />,
    )
    await expect.element(page.getByTestId('reader')).toBeInTheDocument()
    editor.current?.focus()
    editor.current?.setSelection({ type: 'text', anchor: 1, head: 14 })
    expect(editor.current?.getSelectedText()).toBe('![[Original]]')
    await userEvent.keyboard('{Backspace}')
    await expect.element(page.getByTestId('reader')).not.toBeInTheDocument()
    expect(editor.current?.getMarkdown().trim()).toBe('')
  })

  it('uses the parser-resolved target and label in both editing and read-only readers', async () => {
    const resolveWikiEmbed = () => ({
      kind: 'note' as const,
      target: 'Canonical',
      display: 'Resolved label',
    })
    const source = '![[Authored]]'
    const editor = createRef<EditorHandle>()
    await render(
      <>
        <MarkdownEditor
          initialMarkdown={source}
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderNoteEmbed}
          handleRef={editor}
        />
        <MarkdownView
          markdown={source}
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderNoteEmbed}
        />
      </>,
    )
    await expect
      .element(page.getByRole('button', { name: 'Resolved label', exact: true }))
      .toHaveLength(2)
    expect(editor.current?.getMarkdown()).toBe(`${source}\n`)
  })

  it('unmounts host readers when their reference is removed', async () => {
    const disposed = vi.fn()
    function LifecycleReader(): ReactElement {
      useEffect(() => disposed, [])
      return <div data-testid="lifecycle-reader">Body</div>
    }
    const editor = createRef<EditorHandle>()
    await render(
      <MarkdownEditor
        initialMarkdown="![[Original]]"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={() => <LifecycleReader />}
        handleRef={editor}
      />,
    )
    await expect.element(page.getByTestId('lifecycle-reader')).toBeInTheDocument()
    editor.current?.setMarkdown('Removed')
    await vi.waitFor(() => expect(disposed).toHaveBeenCalledTimes(1))
  })

  it('uses the same renderer in read-only Markdown without a paragraph around its body', async () => {
    await render(
      <MarkdownView
        markdown="![[Original|Read original]]"
        resolveWikiEmbed={resolveWikiEmbed}
        renderNoteEmbed={renderNoteEmbed}
      />,
    )
    const button = page.getByRole('button', { name: 'Read original', exact: true })
    await expect.element(button).toBeInTheDocument()
    await button.click()
    await expect.element(page.getByText('Original body')).toBeInTheDocument()
    expect(page.getByTestId('reader').element().closest('p')).toBeNull()
  })

  it('does not call the host renderer in passive, inline, heading, mixed-text, or multi-embed views', async () => {
    const renderer = vi.fn(renderNoteEmbed)
    await render(
      <>
        <MarkdownView
          markdown="![[Original]]"
          interactive={false}
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderer}
        />
        <MarkdownView
          markdown="![[Original]]"
          singleParagraph
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderer}
        />
        <MarkdownView
          markdown={'# ![[Original]]\n\nBefore ![[Original]] after\n\n![[One]] ![[Two]]'}
          resolveWikiEmbed={resolveWikiEmbed}
          renderNoteEmbed={renderer}
        />
      </>,
    )
    expect(renderer).not.toHaveBeenCalled()
    await expect.element(page.getByTestId('wikilink')).toHaveLength(6)
  })

  it('keeps unresolved and attachment embeds on their original rendering paths', async () => {
    const renderer = vi.fn(renderNoteEmbed)
    await render(
      <MarkdownView
        markdown={'![[Missing]]\n\n![[paper.pdf]]'}
        resolveWikiEmbed={({ target }) => (target.endsWith('.pdf') ? { kind: 'file' } : undefined)}
        renderNoteEmbed={renderer}
      />,
    )
    expect(renderer).not.toHaveBeenCalled()
    await expect.element(page.getByTestId('file-pill')).toBeInTheDocument()
    await expect.element(page.getByText('![[Missing]]')).toBeInTheDocument()
  })
})
