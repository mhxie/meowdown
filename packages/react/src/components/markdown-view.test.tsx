import '../testing/index.ts'

import {
  isNodeOfType,
  type FileClickHandler,
  type ImageClickHandler,
  type WikilinkResolver,
} from '@meowdown/core'
import type { XPostMediaClickEvent } from '@meowdown/embed/x'
import type { YouTubeVideoClickEvent } from '@meowdown/embed/youtube'
import type { XPost } from '@post-embed/types'
import { describe, expect, it, vi } from 'vitest'
import { render } from 'vitest-browser-react'
import { page, userEvent } from 'vitest/browser'

import { resolveWikilinkAlias } from '../testing/resolve-wikilink-alias.ts'
import { createTweet } from '../testing/tweet-fixture.ts'
import { createXPost } from '../testing/x-post-fixture.ts'
import { createYouTubeVideo } from '../testing/youtube-fixture.ts'

import { MarkdownView, type MarkdownBlockRenderer } from './markdown-view.tsx'

// A photo that loads without the network: the card hides one that fails.
const PHOTO_URL =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20width='100'%20height='100'/%3E"
import { ProseKitEditor } from './prosekit-editor.tsx'

const view = page.getByTestId('markdown-view')
const wikilink = view.getByTestId('wikilink')

function renderView(markdown: string, props: Record<string, unknown> = {}) {
  return render(
    <div data-testid="markdown-view">
      <MarkdownView markdown={markdown} {...props} />
    </div>,
  )
}

describe('MarkdownView', () => {
  it('demotes real heading elements, including setext headings, while preserving code', async () => {
    await renderView(
      '# Title\n\n## Section\n\n### Detail\n\n#### Fourth\n\n##### Fifth\n\n###### Sixth\n\nSetext\n===\n\n```md\n# Literal\n```',
      { headingOffset: 1 },
    )
    for (const [name, level] of [
      ['Title', 2],
      ['Section', 3],
      ['Detail', 4],
      ['Fourth', 5],
      ['Fifth', 6],
      ['Sixth', 6],
      ['Setext', 2],
    ] as const) {
      await expect.element(view.getByRole('heading', { name, level })).toBeInTheDocument()
    }
    expect(view.element().querySelector('h1, h7')).toBeNull()
    await expect.element(view.locate('pre code')).toHaveTextContent('# Literal')
  })

  it('updates the rendered heading depth without changing the source or other views', async () => {
    const markdown = '# Title\n\n## Section'
    const screen = await renderView(markdown, { headingOffset: 2 })
    await expect.element(view.getByRole('heading', { name: 'Title', level: 3 })).toBeVisible()
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={markdown} />
      </div>,
    )
    await expect.element(view.getByRole('heading', { name: 'Title', level: 1 })).toBeVisible()
    await expect.element(view.getByRole('heading', { name: 'Section', level: 2 })).toBeVisible()
  })

  it('shares reference metadata, source labels, and keyboard navigation with the editor', async () => {
    const resolveWikilink = vi.fn<WikilinkResolver>(({ metadata }) => {
      return metadata?.citation
        ? {
            target: 'Note#^c2',
            display: 'Note, claim 2',
            appearance: 'reference',
            description: 'Recorded 2026-10-06',
          }
        : undefined
    })
    const onWikilinkClick = vi.fn()
    await renderView(
      '[[Note#^c2|ref]]<!-- {"metadata":{"citation":{"valid_at":"2026-10-06"}}} -->',
      {
        resolveWikilink,
        onWikilinkClick,
      },
    )
    expect(resolveWikilink).toHaveBeenCalledWith({
      target: 'Note#^c2|ref',
      metadata: { citation: { valid_at: '2026-10-06' } },
    })
    await expect.element(wikilink).toHaveClass('meowdown-reference')
    await expect.element(wikilink).toHaveAccessibleName('Note, claim 2')
    await expect.element(wikilink).toHaveAttribute('aria-description', 'Recorded 2026-10-06')
    wikilink.element().focus()
    await userEvent.keyboard('{Enter}')
    expect(onWikilinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note#^c2' }))
    await wikilink.click()
    expect(onWikilinkClick).toHaveBeenCalledTimes(2)
  })

  it('shares a root-scoped CSS reference counter with custom blocks in document order', async () => {
    const reference = '[[Note|ref]]<!-- {"metadata":{"source":true}} -->'
    const resolveWikilink: WikilinkResolver = () => ({ appearance: 'reference', display: 'Note' })
    const renderBlock: MarkdownBlockRenderer = ({ node }) => {
      return isNodeOfType(node, 'codeBlock') ? (
        <span className="meowdown-reference" aria-label="External source" />
      ) : undefined
    }
    await renderView(`${reference}${reference}\n\n\`\`\`source\nExternal\n\`\`\`\n\n${reference}`, {
      resolveWikilink,
      renderBlock,
    })
    const root = view.element().querySelector('.ProseMirror')!
    expect(getComputedStyle(root).counterReset).toBe('meowdown-reference 0')
    const references = [...root.querySelectorAll('.meowdown-reference')]
    expect(references.map((reference) => reference.getAttribute('aria-label'))).toEqual([
      'Note',
      'Note',
      'External source',
      'Note',
    ])
    for (const reference of references) {
      expect(getComputedStyle(reference).counterIncrement).toBe('meowdown-reference 1')
      expect(getComputedStyle(reference, '::before').content).toContain(
        'counter(meowdown-reference)',
      )
    }
  })

  it('keeps malformed and unclaimed metadata readable without reference appearance', async () => {
    await renderView('[[Note|ref]]<!-- {"metadata":null} --> and [[Plain]]', {
      resolveWikilink: resolveWikilinkAlias,
    })
    expect(view.element().querySelector('.meowdown-reference')).toBeNull()
    expect(view.element().textContent).toContain('<!-- {"metadata":null} -->')
    await expect.element(wikilink.last()).toHaveTextContent('Plain')
  })

  it('renders references passively when interactivity is disabled', async () => {
    const onWikilinkClick = vi.fn()
    await renderView('[[Note]]', {
      interactive: false,
      resolveWikilink: () => ({ appearance: 'reference' }),
      onWikilinkClick,
    })
    await expect.element(wikilink).toHaveClass('meowdown-reference')
    expect(wikilink.element().getAttribute('tabindex')).toBeNull()
    await wikilink.click()
    expect(onWikilinkClick).not.toHaveBeenCalled()
  })

  it('customizes blocks with raw source and falls back to the normal renderer', async () => {
    const renderBlock = vi.fn<MarkdownBlockRenderer>(({ node, renderDefault, interactive }) => {
      if (isNodeOfType(node, 'codeBlock') && node.attrs.language === 'custom') {
        return <aside>{node.textContent}</aside>
      }
      if (isNodeOfType(node, 'paragraph') && node.textContent.startsWith('special ')) {
        return <section data-interactive={interactive}>{renderDefault()}</section>
      }
    })
    await renderView('special [[Note]]\n\nordinary **bold**\n\n\`\`\`custom\nBody\n\`\`\`', {
      renderBlock,
    })
    await expect.element(view.locate('aside')).toHaveTextContent('Body')
    await expect.element(view.locate('section')).toHaveAttribute('data-interactive', 'true')
    await expect.element(view.locate('strong')).toMatchTextContent('bold')
    expect(
      renderBlock.mock.calls.some(([context]) => context.node.textContent === 'special [[Note]]'),
    ).toBe(true)
  })

  it('provides the original adjacent blocks and null at document boundaries', async () => {
    const renderBlock = vi.fn<MarkdownBlockRenderer>()
    await renderView('First\n\n```custom\nMiddle\n```\n\nLast', { renderBlock })
    const contexts = new Map(
      renderBlock.mock.calls.map(([context]) => [context.node.textContent, context]),
    )
    expect(contexts.get('First')?.previousSibling).toBeNull()
    expect(contexts.get('First')?.nextSibling).toBe(contexts.get('Middle')?.node)
    expect(contexts.get('Middle')?.previousSibling).toBe(contexts.get('First')?.node)
    expect(contexts.get('Middle')?.nextSibling).toBe(contexts.get('Last')?.node)
    expect(contexts.get('Last')?.previousSibling).toBe(contexts.get('Middle')?.node)
    expect(contexts.get('Last')?.nextSibling).toBeNull()
  })

  it('provides source positions and inline fragments without splitting a paragraph', async () => {
    const renderBlock: MarkdownBlockRenderer = ({ node, doc, position, renderInline }) => {
      expect(doc.nodeAt(position)).toBe(node)
      if (isNodeOfType(node, 'paragraph') && node.textContent === '**First** and second') {
        return (
          <p>
            <span data-range="one">{renderInline(node.content.cut(0, 9))}</span>
            {renderInline(node.content.cut(9))}
          </p>
        )
      }
    }
    await renderView('# Title\n\n**First** and second', { renderBlock })
    await expect.element(view.locate('p')).toHaveTextContent('**First** and second')
    await expect.element(view.locate('[data-range="one"] strong')).toMatchTextContent('First')
    expect(getComputedStyle(view.element().querySelector('.md-mark')!).fontSize).toBe('0px')
    expect(view.element().querySelectorAll('p')).toHaveLength(1)
  })

  it('renders trimmed content with the same inline resolvers and reference definitions', async () => {
    const source = '**Bold** [[Note|Alias]] and [manual][docs]. Hidden suffix'
    const resolveWikilink = vi.fn(resolveWikilinkAlias)
    const onWikilinkClick = vi.fn()
    const renderBlock = vi.fn<MarkdownBlockRenderer>(({ node, renderDefault }) => {
      if (node.textContent === source) {
        return renderDefault(node.content.cut(0, source.indexOf(' Hidden suffix')))
      }
    })
    await renderView(`${source}\n\n[docs]: https://example.com/docs`, {
      renderBlock,
      resolveWikilink,
      onWikilinkClick,
    })
    await expect.element(view.locate('p')).toBeInTheDocument()
    await expect.element(view.locate('strong')).toMatchTextContent('Bold')
    await expect.element(wikilink).toHaveTextContent('Alias')
    await expect.element(view.locate('a')).toHaveAttribute('href', 'https://example.com/docs')
    expect(view.element().textContent).not.toContain('Hidden suffix')
    expect(resolveWikilink).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note|Alias' }))
    await wikilink.click()
    expect(onWikilinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note' }))
    expect(renderBlock.mock.calls[0][0].node.textContent).toBe(source)
  })

  it('retains enclosing emphasis when rendering independently annotated text ranges', async () => {
    const renderBlock: MarkdownBlockRenderer = ({ node, renderInlineRange }) => {
      if (!isNodeOfType(node, 'paragraph')) return
      return (
        <p>
          {renderInlineRange(0, 9)}
          <span data-claim>{renderInlineRange(9, 17)}</span>
          {renderInlineRange(17, node.textContent.length)}
        </p>
      )
    }
    await renderView('**before selected after**', { renderBlock })
    await expect.element(view.locate('[data-claim] strong')).toHaveTextContent('selected')
    expect(view.element().querySelectorAll('p')).toHaveLength(1)
    expect(view.element().querySelectorAll('strong')).toHaveLength(3)
  })

  it('keeps the full default fallback when a custom fragment is not returned', async () => {
    const renderBlock: MarkdownBlockRenderer = ({ node, renderDefault }) => {
      void renderDefault(node.content.cut(0, 4))
    }
    await renderView('Full **source**', { renderBlock })
    await expect.element(view.locate('strong')).toMatchTextContent('source')
  })

  it('ignores container replacements so task clicks still identify the source task', async () => {
    const onTaskClick = vi.fn()
    const renderBlock: MarkdownBlockRenderer = ({ node, renderDefault }) => {
      if (isNodeOfType(node, 'blockquote')) {
        return renderDefault(node.content.cut(node.firstChild!.nodeSize))
      }
    }
    await renderView('> - [ ] First\n> - [ ] Second', { renderBlock, onTaskClick })
    await expect.element(view.locate('p').first()).toHaveTextContent('First')
    await expect.element(view.locate('p').last()).toHaveTextContent('Second')
    expect(view.element().querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
    await view.locate('input[type="checkbox"]').nth(1).click()
    expect(onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ index: 1, text: 'Second' }))
  })

  it('ignores replacement fragments that are invalid for a textblock', async () => {
    const renderBlock: MarkdownBlockRenderer = ({ node, previousSibling, renderDefault }) => {
      if (node.textContent === 'Summary' && previousSibling) {
        return renderDefault(previousSibling.content)
      }
    }
    await renderView('> - [ ] First\n> - [ ] Second\n\nSummary', { renderBlock })
    await expect.element(view.locate('p').last()).toHaveTextContent('Summary')
    expect(view.element().querySelectorAll('input[type="checkbox"]')).toHaveLength(2)
  })

  it('trims nested task textblocks without changing task indexes or source labels', async () => {
    const onTaskClick = vi.fn()
    const renderBlock: MarkdownBlockRenderer = ({ node, renderDefault }) => {
      if (node.isTextblock && node.textContent === '**First** suffix') {
        return renderDefault(node.content.cut(0, '**First**'.length))
      }
    }
    await renderView('> - [ ] **First** suffix\n> - [ ] Second', { renderBlock, onTaskClick })
    await expect.element(view.locate('strong')).toMatchTextContent('First')
    expect(view.element().textContent).not.toContain('suffix')
    await view.locate('input[type="checkbox"]').first().click()
    expect(onTaskClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 0, text: '**First** suffix' }),
    )
    await view.locate('input[type="checkbox"]').last().click()
    expect(onTaskClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 1, text: 'Second' }),
    )
  })

  it('renders inline marks as rich text, not source', async () => {
    await renderView('**bold** and *italic* and `code`')
    // The bug renders these as plain `**bold**` text with no element; rich
    // rendering produces real strong/em/code elements.
    await expect.element(view.locate('strong').first()).toBeInTheDocument()
    await expect.element(view.locate('em').first()).toBeInTheDocument()
    await expect.element(view.locate('code').first()).toBeInTheDocument()
  })

  it('renders a wikilink as a chip showing the target', async () => {
    await renderView('[[Reflect Playground 4]]')
    await expect.element(wikilink).toHaveTextContent('Reflect Playground 4')
  })

  it('renders the label the host resolver splits from an alias', async () => {
    await renderView('[[target|Alias]]', { resolveWikilink: resolveWikilinkAlias })
    await expect.element(wikilink).toHaveTextContent('Alias')
  })

  it('calls onWikilinkClick with the target', async () => {
    const onWikilinkClick = vi.fn()
    await renderView('[[Note]]', { onWikilinkClick })
    await wikilink.click()
    expect(onWikilinkClick).toHaveBeenCalledTimes(1)
    expect(onWikilinkClick).toHaveBeenCalledWith(expect.objectContaining({ target: 'Note' }))
  })

  it('renders an image preview', async () => {
    await renderView('![cat](https://example.com/cat.png)')
    const img = view.getByTestId('image-preview').locate('img')
    await expect.element(img).toHaveAttribute('src', 'https://example.com/cat.png')
    await expect.element(img).toHaveAttribute('alt', 'cat')
  })

  it('applies a size comment to an image inside a link', async () => {
    await renderView('[![cat](https://example.com/cat.png)<!-- {"width":320} -->](/target)')
    const img = view.getByTestId('image-preview').locate('img')
    await expect.element(img).toHaveStyle({ width: '320px' })
  })

  it('renders a resolved wiki image with its alias and width', async () => {
    await renderView('![[assets/cat.png|120]]', {
      resolveWikiEmbed: () => ({ kind: 'image' }),
      resolveImageUrl: (src: string) => `asset://${src}`,
    })
    const img = view.getByTestId('image-preview').locate('img')
    await expect.element(img).toHaveAttribute('src', 'asset://assets/cat.png')
    await expect.element(img).toHaveAttribute('alt', 'cat.png')
    await expect.element(img).toHaveStyle({ width: '120px' })
  })

  it('renders a resolved wiki file as a pill and reports clicks', async () => {
    const onFileClick = vi.fn()
    await renderView('![[docs/report.pdf|Quarterly]]', {
      resolveWikiEmbed: () => ({ kind: 'file' }),
      resolveFileInfo: () => ({ size: 1_400_000 }),
      onFileClick,
    })
    const pill = view.getByTestId('file-pill')
    await expect.element(pill).toMatchTextContent('Quarterly')
    await expect.element(view.getByTestId('file-pill-size')).toHaveTextContent('1.4 MB')
    await pill.click()
    expect(onFileClick).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'docs/report.pdf', name: 'Quarterly' }),
    )
  })

  it('renders a claimed standard Markdown file link as a pill', async () => {
    const resolveFileLink = vi.fn(({ href }: { href: string }) => href.startsWith('docs/'))
    await renderView('[Quarterly](docs/report.pdf "Report")', { resolveFileLink })

    await expect.element(view.getByTestId('file-pill')).toHaveTextContent('Quarterly')
    expect(view.element().querySelector('a')).toBeNull()
    expect(resolveFileLink).toHaveBeenCalledWith({
      href: 'docs/report.pdf',
      label: 'Quarterly',
      title: 'Report',
    })
  })

  it('leaves an unclaimed standard Markdown link as a link', async () => {
    await renderView('[Website](https://example.com)', { resolveFileLink: () => false })

    await expect.element(view.locate('a')).toHaveAttribute('href', 'https://example.com')
    expect(view.element().querySelector('[data-testid="file-pill"]')).toBeNull()
  })

  it('renders full, collapsed, and shortcut reference links', async () => {
    await renderView(
      '[Full][docs], [docs][], and [docs].\n\n[docs]: https://example.com "Documentation"',
    )

    const links = view.locate('a[href="https://example.com"]')
    await expect.element(links).toHaveLength(3)
    await expect.element(view).not.toMatchTextContent('[docs]:')
  })

  it('uses the first normalized reference definition', async () => {
    await renderView(
      '[Plan][ DOCS ]\n\n[docs]: https://first.example\n\n[DOCS]: https://second.example',
    )

    await expect
      .element(view.getByText('Plan', { exact: false }))
      .toHaveAttribute('href', 'https://first.example')
    await expect.element(view).not.toMatchTextContent('https://second.example')
  })

  it('renders a reference image and omits its definition', async () => {
    await renderView('![Diagram][asset]\n\n[asset]: https://example.com/diagram.png "System"')

    const image = view.getByAltText('Diagram')
    await expect.element(image).toHaveAttribute('src', 'https://example.com/diagram.png')
    await expect.element(view).not.toMatchTextContent('[asset]:')
  })

  it('resolves a definition inside a blockquote', async () => {
    await renderView('> [docs]: https://example.com\n\nRead [Docs].')

    await expect
      .element(view.getByText('Docs', { exact: false }))
      .toHaveAttribute('href', 'https://example.com')
    await expect.element(view).not.toMatchTextContent('[docs]:')
  })

  it('reports clicks from a reference link', async () => {
    const onLinkClick = vi.fn()
    await renderView('[Docs][docs]\n\n[docs]: https://example.com', { onLinkClick })

    await view.locate('a[href="https://example.com"]').click()
    expect(onLinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'https://example.com' }),
    )
  })

  it('resolves metadata for a claimed standard Markdown file link', async () => {
    const resolveFileInfo = vi.fn(() => ({ size: 1_400_000 }))
    await renderView('[Quarterly](docs/report.pdf)', {
      resolveFileLink: () => true,
      resolveFileInfo,
    })

    await expect.element(view.getByTestId('file-pill-size')).toHaveTextContent('1.4 MB')
    expect(resolveFileInfo).toHaveBeenCalledExactlyOnceWith('docs/report.pdf')
  })

  it('reports clicks on a claimed standard Markdown file link', async () => {
    const onFileClick = vi.fn<FileClickHandler>()
    await renderView('[Quarterly](docs/report.pdf)', {
      resolveFileLink: () => true,
      onFileClick,
    })

    await view.getByTestId('file-pill').click()
    expect(onFileClick).toHaveBeenCalledWith(
      expect.objectContaining({ href: 'docs/report.pdf', name: 'Quarterly' }),
    )
    expect(onFileClick.mock.calls[0][0].event).toBeInstanceOf(MouseEvent)
  })

  it('keeps a claimed standard file pill passive when interactive is false', async () => {
    const onFileClick = vi.fn()
    await renderView('[Quarterly](docs/report.pdf)', {
      interactive: false,
      resolveFileLink: () => true,
      onFileClick,
    })

    const pill = view.getByTestId('file-pill')
    await expect.element(pill).toHaveTextContent('Quarterly')
    expect(view.element().querySelector('a')).toBeNull()
    await pill.click()
    expect(onFileClick).not.toHaveBeenCalled()
  })

  it('renders a resolved wiki note through the wikilink hook', async () => {
    const onWikilinkClick = vi.fn()
    await renderView('![[Projects/Plan|Launch plan]]', {
      resolveWikiEmbed: () => ({ kind: 'note' }),
      onWikilinkClick,
    })
    await expect.element(wikilink).toHaveTextContent('Launch plan')
    await wikilink.click()
    expect(onWikilinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'Projects/Plan' }),
    )
  })

  it('leaves an unresolved wiki embed literal', async () => {
    await renderView('![[ambiguous.png]]', { resolveWikiEmbed: () => undefined })
    await expect.element(view).toHaveTextContent('![[ambiguous.png]]')
    expect(view.element().querySelector('.md-atom-view')).toBeNull()
  })

  it('renders a resolved wikilink label and reports the full target', async () => {
    const onWikilinkClick = vi.fn()
    await renderView('[[Tim MacCaw // Dad]]', {
      resolveWikilink: ({ target }: { target: string }) => ({ display: target.split(' // ')[0] }),
      onWikilinkClick,
    })
    await expect.element(wikilink).toHaveTextContent('Tim MacCaw')
    await wikilink.click()
    expect(onWikilinkClick).toHaveBeenCalledWith(
      expect.objectContaining({ target: 'Tim MacCaw // Dad' }),
    )
  })

  it('renders an X post card through the default resolver', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: { ...createTweet('fetched by default'), id_str: '3001' } }),
        ),
      )
    try {
      await renderView('![](https://x.com/jack/status/3001)')
      const card = view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]')
      await expect.element(card).toMatchTextContent('fetched by default')
      expect(fetchSpy).toHaveBeenCalledExactlyOnceWith(
        'https://react-tweet.vercel.app/api/tweet/3001',
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('accepts separate resolver and media protocol props', async () => {
    const post = createXPost()
    post.media = [
      { type: 'photo', url: 'reflect-asset://saved/photo.png', width: 100, height: 100 },
    ]
    await renderView('![](https://x.com/jack/status/20)', {
      resolveXPost: () => post,
      mediaUrlProtocols: ['reflect-asset:'],
    })
    await expect
      .element(view.getByTestId('x-post-embed').locate('[data-media] img'))
      .toHaveAttribute('src', 'reflect-asset://saved/photo.png')
  })

  it('reports a clicked image with its element', async () => {
    const onImageClick = vi.fn<ImageClickHandler>()
    await renderView('![cat](cat.png)', {
      resolveImageUrl: () => PHOTO_URL,
      onImageClick,
    })
    const image = view.getByTestId('image-preview').locate('img')
    await expect.element(image).toBeInTheDocument()
    await image.click()
    expect(onImageClick).toHaveBeenCalledTimes(1)
    const payload = onImageClick.mock.calls[0][0]
    expect(payload).toMatchObject({ src: 'cat.png', alt: 'cat' })
    expect(payload.element).toBe(image.element())
  })

  it('reports a clicked X post photo', async () => {
    const post = createXPost()
    post.media = [{ type: 'photo', url: PHOTO_URL, width: 100, height: 100 }]
    const onXPostMediaClick = vi.fn((event: XPostMediaClickEvent) => event.preventDefault())
    await renderView('![](https://x.com/jack/status/20)', {
      resolveXPost: () => post,
      mediaUrlProtocols: ['data:'],
      onXPostMediaClick,
    })
    const image = view.getByTestId('x-post-embed').locate('[data-media] img')
    await expect.element(image).toBeInTheDocument()
    await image.click()
    expect(onXPostMediaClick).toHaveBeenCalledTimes(1)
    expect(onXPostMediaClick.mock.calls[0][0].detail).toMatchObject({
      index: 0,
      media: { type: 'photo', url: PHOTO_URL },
    })
  })

  it('renders an X post card from a synchronous snapshot', async () => {
    await renderView('![](https://x.com/jack/status/20)', {
      resolveXPost: () => createXPost(),
    })
    const card = view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]')
    await expect.element(card).toMatchTextContent('just setting up my twttr')
  })

  it('shows the loading card until a promised snapshot settles', async () => {
    let settle!: (post: XPost) => void
    const pending = new Promise<XPost>((resolve) => {
      settle = resolve
    })
    await renderView('![](https://x.com/jack/status/20)', { resolveXPost: () => pending })
    const card = view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]')
    await expect.element(card.locate('[data-fallback][data-pending]')).toBeInTheDocument()

    settle(createXPost())
    await expect.element(card).toMatchTextContent('just setting up my twttr')
    expect(card.locate('[data-pending]').query()).toBeNull()
  })

  it('renders host data even when source contains an old snapshot', async () => {
    const resolveXPost = vi.fn(() => createXPost())
    const comment = `<!-- ${JSON.stringify({ snapshot: { kind: 'x-post', data: createXPost('saved') } })} -->`
    await renderView(`![](https://x.com/jack/status/20)${comment}`, {
      resolveXPost,
    })
    const card = view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]')
    await expect.element(card).toMatchTextContent('just setting up my twttr')
    expect(resolveXPost).toHaveBeenCalledOnce()
    expect(card.locate('[data-fallback]').query()).toBeNull()
  })

  it('resolves when the saved snapshot does not validate', async () => {
    await renderView(
      '![](https://x.com/jack/status/20)<!-- {"snapshot":{"kind":"x-post","data":{"bogus":1}}} -->',
      { resolveXPost: () => createXPost() },
    )
    const card = view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]')
    await expect.element(card).toMatchTextContent('just setting up my twttr')
  })

  it('renders the unavailable card without a snapshot', async () => {
    await renderView('![](https://x.com/jack/status/20)', {
      resolveXPost: () => undefined,
    })
    await expect
      .element(view.getByTestId('x-post-embed').locate('[data-fallback]'))
      .toBeInTheDocument()
  })

  it('renders a YouTube video card', async () => {
    await renderView('![](https://youtu.be/aqz-KE-bpKQ)', {
      resolveYouTubeVideo: () => createYouTubeVideo(),
    })
    const card = view.getByTestId('youtube-video-embed').locate('[data-meowdown-embed="youtube"]')
    await expect.element(card).toMatchTextContent('Big Buck Bunny')
    expect(view.locate('iframe').query()).toBeNull()
  })

  it('reports a clicked YouTube poster instead of playing in the card', async () => {
    const onYouTubeVideoClick = vi.fn((event: YouTubeVideoClickEvent) => event.preventDefault())
    await renderView('![](https://youtu.be/aqz-KE-bpKQ)<!-- {"width":320} -->', {
      resolveYouTubeVideo: () => createYouTubeVideo(),
      onYouTubeVideoClick,
    })
    await view.getByRole('button', { name: 'Play: Big Buck Bunny' }).click()
    expect(onYouTubeVideoClick).toHaveBeenCalledTimes(1)
    expect(onYouTubeVideoClick.mock.calls[0][0].detail).toMatchObject({ videoId: 'aqz-KE-bpKQ' })
    expect(view.locate('iframe').query()).toBeNull()
  })

  it('applies a persisted width to a YouTube video card', async () => {
    await renderView('![](https://youtu.be/aqz-KE-bpKQ)<!-- {"width":320} -->', {
      resolveYouTubeVideo: () => createYouTubeVideo(),
    })
    const card = view.getByTestId('youtube-video-embed').locate('[data-meowdown-embed="youtube"]')
    await expect.element(card).toMatchTextContent('Big Buck Bunny')
    expect(getComputedStyle(card.element()).width).toBe('320px')
  })

  it('shows embeds as their source URLs when remoteMedia is false', async () => {
    const tweet = 'https://x.com/jack/status/20'
    const video = 'https://youtu.be/aqz-KE-bpKQ'
    // A saved card whose poster would load from the network if it rendered.
    const snapshot = {
      kind: 'youtube-video',
      data: { ...createYouTubeVideo(), thumbnail_url: 'https://i.ytimg.com/vi/aqz-KE-bpKQ/0.jpg' },
    }
    const resolveXPost = vi.fn(() => createXPost())
    const resolveYouTubeVideo = vi.fn(() => createYouTubeVideo())
    const resolveImageUrl = vi.fn((src: string) => src)
    const markdown = `![](${tweet})\n\n![](${video})<!-- ${JSON.stringify({ snapshot })} -->`
    const screen = await renderView(markdown, {
      remoteMedia: false,
      resolveXPost,
      resolveYouTubeVideo,
      resolveImageUrl,
    })

    const links = view.getByTestId('embed-link')
    await expect.element(links.first()).toHaveTextContent(tweet)
    await expect.element(links.last()).toHaveTextContent(video)
    const root = view.element()
    expect(root.querySelector('img, iframe, meowdown-embed-x, meowdown-embed-youtube')).toBeNull()
    expect(resolveXPost).not.toHaveBeenCalled()
    expect(resolveYouTubeVideo).not.toHaveBeenCalled()
    expect(resolveImageUrl).not.toHaveBeenCalled()

    // Turned back on, the same view renders the cards.
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={`![](${tweet})`} resolveXPost={resolveXPost} />
      </div>,
    )
    await expect
      .element(view.getByTestId('x-post-embed').locate('[data-meowdown-embed="x"]'))
      .toMatchTextContent('just setting up my twttr')
    expect(links.query()).toBeNull()
  })

  it('omits recognized embeds before resolving images when interactive is false', async () => {
    const resolveImageUrl = vi.fn((src: string) => src)
    await renderView('![](https://x.com/jack/status/20)\n\n![](https://youtu.be/dQw4w9WgXcQ)', {
      interactive: false,
      resolveImageUrl,
    })

    expect(view.element().querySelector('iframe')).toBeNull()
    expect(resolveImageUrl).not.toHaveBeenCalled()
  })

  it('renders a passive tree when interactive is false', async () => {
    const onWikilinkClick = vi.fn()
    const onLinkClick = vi.fn()
    const onImageClick = vi.fn()
    const onFileClick = vi.fn()
    const onTaskClick = vi.fn()
    await renderView(
      '[[Note]] [Docs](https://example.com) ![cat](https://example.com/cat.png) ![[report.pdf]]\n\n![](https://x.com/jack/status/20)\n\n+ [ ] task',
      {
        interactive: false,
        resolveWikiEmbed: () => ({ kind: 'file' }),
        onWikilinkClick,
        onLinkClick,
        onImageClick,
        onFileClick,
        onTaskClick,
      },
    )

    const root = view.element()
    expect(root.querySelector('a')).toBeNull()
    expect(root.querySelector('iframe')).toBeNull()
    expect(
      root.querySelectorAll(
        'button, input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      ),
    ).toHaveLength(0)
    await wikilink.click()
    await view.getByText('Docs', { exact: false }).click()
    await view.getByAltText('cat').click()
    await view.getByTestId('file-pill').click()
    expect(onWikilinkClick).not.toHaveBeenCalled()
    expect(onLinkClick).not.toHaveBeenCalled()
    expect(onImageClick).not.toHaveBeenCalled()
    expect(onFileClick).not.toHaveBeenCalled()
    expect(onTaskClick).not.toHaveBeenCalled()
  })

  it('reserves a sized box for an async image resolver, then renders the image', async () => {
    let resolve!: (url: string) => void
    const promise = new Promise<string>((res) => {
      resolve = res
    })
    await renderView('![cat](cat.png)<!-- {"width":120,"height":80} -->', {
      resolveImageUrl: () => promise,
    })
    const box = view.getByTestId('image-resizable')
    await expect.element(box).toHaveAttribute('data-loading', '')
    await expect.element(box).toHaveStyle({ width: '120px', height: '80px' })
    expect(box.locate('img').elements()).toHaveLength(0)

    resolve(PHOTO_URL)
    await expect
      .element(view.getByTestId('image-preview').locate('img'))
      .toHaveAttribute('src', PHOTO_URL)
  })

  it('highlights a code block with syntax tokens', async () => {
    await renderView('```rust\nfn main() {}\n```')
    await expect
      .element(view.locate('pre code [class*="tok-"]').first(), { timeout: 15000 })
      .toBeInTheDocument()
  })

  it('applies a custom mark mode to the root', async () => {
    await renderView('hello', { markMode: 'show' })
    await expect.element(view.locate('.ProseMirror')).toHaveAttribute('data-mark-mode', 'show')
  })

  it('defaults to hide mark mode', async () => {
    await renderView('hello')
    await expect.element(view.locate('.ProseMirror')).toHaveAttribute('data-mark-mode', 'hide')
  })

  it('renders headings, lists and blockquotes', async () => {
    await renderView('# Title\n\n- one\n- two\n\n> quote')
    await expect.element(view.locate('h1')).toHaveTextContent('Title')
    // flat-list renders list items as `div.prosemirror-flat-list`, like the editor.
    await expect.element(view.locate('.prosemirror-flat-list').first()).toHaveTextContent('one')
    await expect.element(view.locate('blockquote')).toHaveTextContent('quote')
  })

  it('folds a collapsed bullet, like the editor', async () => {
    await renderView('+ parent\n  - child')
    await expect.element(view.locate('[data-list-collapsed]')).toMatchTextContent('parent')
    await expect.element(view.getByText('child')).not.toBeVisible()
  })

  it('renders a collapsed bullet expanded with expandCollapsed', async () => {
    await renderView('+ parent\n  - child', { expandCollapsed: true })
    await expect.element(view.getByText('child')).toBeVisible()
    await expect.element(view.locate('[data-list-collapsed]')).not.toBeInTheDocument()
  })

  it('expands collapsed bullets at every depth', async () => {
    await renderView('+ parent\n  + middle\n    - leaf', { expandCollapsed: true })
    await expect.element(view.getByText('leaf')).toBeVisible()
    await expect.element(view.locate('[data-list-collapsed]')).not.toBeInTheDocument()
  })

  it('keeps a circle task round under expandCollapsed', async () => {
    await renderView('+ [ ] task\n  - child', { expandCollapsed: true })
    const circleTask = view.locate('[data-list-marker="+"]')
    await expect.element(circleTask.locate('input[type="checkbox"]')).toBeInTheDocument()
    await expect.element(view.getByText('child')).toBeVisible()
  })

  it('renders truncated markdown without throwing', async () => {
    await renderView('foo [[Bar and a **bold')
    await expect.element(view).toMatchTextContent('foo')
  })

  it('renders task checkboxes with their checked state', async () => {
    await renderView('+ [ ] open\n+ [x] done')
    const boxes = view.locate('input[type="checkbox"]')
    await expect.element(boxes.first()).not.toBeChecked()
    await expect.element(boxes.last()).toBeChecked()
  })

  it('calls onTaskClick with the document-order index and task facts', async () => {
    const onTaskClick = vi.fn()
    await renderView('+ [ ] first\n+ [x] **second** [[Note]]\n- [ ] square', { onTaskClick })
    await view.locate('input[type="checkbox"]').nth(1).click()
    expect(onTaskClick).toHaveBeenCalledTimes(1)
    expect(onTaskClick).toHaveBeenCalledWith(
      expect.objectContaining({
        index: 1,
        checked: true,
        marker: '+',
        text: '**second** [[Note]]',
      }),
    )
    await view.locate('input[type="checkbox"]').nth(2).click()
    expect(onTaskClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 2, checked: false, marker: '-', text: 'square' }),
    )
  })

  it('numbers a nested task after its parent, in document order', async () => {
    const onTaskClick = vi.fn()
    await renderView('+ [ ] parent\n  + [ ] child\n+ [ ] after', { onTaskClick })
    await view.locate('input[type="checkbox"]').nth(1).click()
    expect(onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ index: 1, text: 'child' }))
    await view.locate('input[type="checkbox"]').nth(2).click()
    expect(onTaskClick).toHaveBeenLastCalledWith(
      expect.objectContaining({ index: 2, text: 'after' }),
    )
  })

  it('never flips a clicked checkbox itself', async () => {
    const onTaskClick = vi.fn()
    await renderView('+ [ ] open', { onTaskClick })
    const box = view.locate('input[type="checkbox"]')
    await expect.element(box, { timeout: 2000 }).not.toBeChecked()
    expect(onTaskClick).toHaveBeenCalledTimes(0)
    await box.click()
    await expect.element(box, { timeout: 2000 }).not.toBeChecked()
    expect(onTaskClick).toHaveBeenCalledTimes(1)
  })

  it('keeps checkboxes inert without an onTaskClick handler', async () => {
    await renderView('+ [x] done')
    const box = view.locate('input[type="checkbox"]')
    await box.click()
    await expect.element(box).toBeChecked()
  })

  it('re-seats checkbox state when the markdown prop changes', async () => {
    const screen = await renderView('+ [ ] task')
    const box = view.locate('input[type="checkbox"]')
    await expect.element(box).not.toBeChecked()
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown="+ [x] task" />
      </div>,
    )
    await expect.element(box).toBeChecked()
  })

  it('updates when the markdown prop changes', async () => {
    const screen = await renderView('first')
    await expect.element(view).toHaveTextContent('first')
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown="second" />
      </div>,
    )
    await expect.element(view).toHaveTextContent('second')
  })
})

describe('MarkdownView block memoization', () => {
  it.each(['previous', 'next'] as const)(
    'updates an unchanged block when only its %s sibling changes',
    async (side) => {
      const renderBlock: MarkdownBlockRenderer = ({ node, previousSibling, nextSibling }) => {
        if (node.textContent === 'Stable') {
          return <p>{`${previousSibling?.textContent} / ${nextSibling?.textContent}`}</p>
        }
      }
      const screen = await renderView('Before\n\nStable\n\nAfter', { renderBlock })
      await expect.element(view.locate('p').nth(1)).toHaveTextContent('Before / After')
      await screen.rerender(
        <div data-testid="markdown-view">
          <MarkdownView
            markdown={
              side === 'previous' ? 'Changed\n\nStable\n\nAfter' : 'Before\n\nStable\n\nChanged'
            }
            renderBlock={renderBlock}
          />
        </div>,
      )
      await expect
        .element(view.locate('p').nth(1))
        .toHaveTextContent(side === 'previous' ? 'Changed / After' : 'Before / Changed')
    },
  )

  it('keeps custom-rendered blocks memoized when a distant block changes', async () => {
    const renderBlock = vi.fn<MarkdownBlockRenderer>(() => undefined)
    const screen = await renderView('First\n\nSecond\n\nThird\n\nFourth', { renderBlock })
    await expect.element(view.locate('p').last()).toHaveTextContent('Fourth')
    renderBlock.mockClear()
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={'First\n\nSecond\n\nThird\n\nChanged'} renderBlock={renderBlock} />
      </div>,
    )
    await expect.element(view.locate('p').last()).toHaveTextContent('Changed')
    expect(renderBlock.mock.calls.map(([context]) => context.node.textContent)).toEqual([
      'Third',
      'Changed',
    ])
  })

  it('parses only the block that changed when the markdown grows', async () => {
    const resolveWikilink = vi.fn(resolveWikilinkAlias)
    const screen = await renderView('[[target|Alias]]\n\nfirst', { resolveWikilink })
    await expect.element(wikilink).toHaveTextContent('Alias')
    const parses = resolveWikilink.mock.calls.length
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView
          markdown={'[[target|Alias]]\n\nfirst\n\nsecond'}
          resolveWikilink={resolveWikilink}
        />
      </div>,
    )
    await expect.element(view.locate('p').last()).toHaveTextContent('second')
    expect(resolveWikilink).toHaveBeenCalledTimes(parses)
  })

  it('keeps task indexes document-wide when a task list appears before an unchanged one', async () => {
    const onTaskClick = vi.fn()
    const screen = await renderView('intro\n\n- [ ] later', { onTaskClick })
    await expect.element(view.locate('input[type="checkbox"]')).toBeInTheDocument()
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={'- [ ] earlier\n\n- [ ] later'} onTaskClick={onTaskClick} />
      </div>,
    )
    await view.locate('input[type="checkbox"]').nth(1).click()
    expect(onTaskClick).toHaveBeenCalledWith(expect.objectContaining({ index: 1, text: 'later' }))
  })

  it('resolves a reference in an unchanged block when its definition arrives later', async () => {
    const screen = await renderView('See [docs].\n\nfiller')
    await expect.element(view.locate('p').first()).toHaveTextContent('See [docs].')
    expect(view.element().querySelector('a')).toBeNull()
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={'See [docs].\n\nfiller\n\n[docs]: https://example.com'} />
      </div>,
    )
    await expect.element(view.locate('a')).toHaveAttribute('href', 'https://example.com')
  })

  it('re-renders a block the appended source merges into', async () => {
    const screen = await renderView('title')
    await expect.element(view.locate('p')).toHaveTextContent('title')
    await screen.rerender(
      <div data-testid="markdown-view">
        <MarkdownView markdown={'title\n==='} />
      </div>,
    )
    await expect.element(view.locate('h1')).toHaveTextContent('title')
  })
})

// Strip editor-only attributes and sort the rest, so two DOM subtrees compare
// equal regardless of attribute order or ProseMirror's editing affordances.
function canonicalize(root: Element): string {
  const SKIP = new Set([
    'contenteditable',
    'translate',
    'draggable',
    'spellcheck',
    'autocorrect',
    'autocapitalize',
    'writingsuggestions',
    'tabindex',
    'readonly',
  ])
  const walk = (node: ChildNode): string => {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (node.nodeType !== Node.ELEMENT_NODE) return ''
    const el = node as Element
    if (el.tagName === 'BR' && el.classList.contains('ProseMirror-trailingBreak')) return ''
    const attrs = Array.from(el.attributes)
      .filter((attr) => !SKIP.has(attr.name) && !(attr.name === 'class' && attr.value === ''))
      // A style attribute set from an HTML string keeps its original spacing,
      // while one round-tripped through the DOM is reformatted; KaTeX output
      // hits both paths, so compare styles whitespace-free.
      .map((attr) => {
        const value = attr.name === 'style' ? attr.value.replaceAll(/\s+/g, '') : attr.value
        return `${attr.name}=${JSON.stringify(value)}`
      })
      .sort()
    const children = Array.from(el.childNodes).map(walk).join('')
    return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${children}</${el.tagName.toLowerCase()}>`
  }
  return Array.from(root.childNodes).map(walk).join('')
}

describe('MarkdownView math', () => {
  it('renders inline math as KaTeX', async () => {
    await renderView('a $E=mc^2$ b')
    await expect.element(view.getByTestId('math-preview').locate('.katex')).toBeInTheDocument()
  })

  it('renders a dollar math block as a display formula', async () => {
    await renderView('$$\nE=mc^2\n$$')
    await expect
      .element(view.getByTestId('code-block-math-preview').locate('.katex'))
      .toBeInTheDocument()
  })

  it('renders a math fence as a display formula', async () => {
    await renderView('```math\nE=mc^2\n```')
    await expect
      .element(view.getByTestId('code-block-math-preview').locate('.katex'))
      .toBeInTheDocument()
  })
})

describe('MarkdownView Mermaid', () => {
  const mermaidPreview = view.getByTestId('code-block-mermaid-preview')

  it('renders a Flowchart as SVG', async () => {
    await renderView('```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```')

    await expect.element(mermaidPreview.locate('svg'), { timeout: 15000 }).toBeInTheDocument()
    await expect.element(mermaidPreview).toMatchTextContent('Start')
    await expect.element(mermaidPreview).toMatchTextContent('End')
  })

  it('renders a Sequence diagram as SVG', async () => {
    await renderView('```mermaid\nsequenceDiagram\n  Alice->>Bob: Hello Bob\n```')

    await expect.element(mermaidPreview.locate('svg'), { timeout: 15000 }).toBeInTheDocument()
    await expect.element(mermaidPreview).toMatchTextContent('Hello Bob')
  })

  it('renders unsupported syntax as an error', async () => {
    await renderView('```mermaid\npie\n  "Dogs" : 10\n```')

    await expect.element(mermaidPreview, { timeout: 15000 }).toHaveAttribute('data-error')
    await expect.element(mermaidPreview).toMatchTextContent(/Invalid|Unsupported/i)
  })

  it('renders passive SVG when interaction is disabled', async () => {
    await renderView('```mermaid\nflowchart LR\n  A --> B\n```', { interactive: false })

    await expect.element(mermaidPreview.locate('svg'), { timeout: 15000 }).toBeInTheDocument()
    await expect
      .element(mermaidPreview.locate('a, button, input, select, textarea, [tabindex], [href]'))
      .not.toBeInTheDocument()
    await expect
      .element(mermaidPreview.locate('[onclick], [onmouseover], [onerror], [onload]'))
      .not.toBeInTheDocument()
  })
})

describe('MarkdownView parity with the editor', () => {
  const editorHost = page.getByTestId('parity-editor')
  const staticHost = page.getByTestId('parity-static')
  // A rich element appears once marks are applied (editor) or on first render
  // (static); waiting on it avoids reading the DOM mid-render.
  const richSelector = 'strong, em, code, del, .md-tag, .md-link, .md-wikilink-view-label'

  it.each([
    '**bold** text',
    '*italic* and `code` and ~~strike~~',
    'a #tag here',
    'link [text](https://example.com) end',
    'a [[Note]] and [[target|Alias]] inline',
    '+ [ ] circle **task**',
    '- [x] square **done**',
  ])('matches the editor for %s', async (markdown) => {
    await render(
      <div data-testid="parity-editor">
        <ProseKitEditor initialMarkdown={markdown} markMode="hide" readOnly />
      </div>,
    )
    await render(
      <div data-testid="parity-static">
        <MarkdownView markdown={markdown} />
      </div>,
    )
    await expect.element(editorHost.locate(richSelector).first()).toBeInTheDocument()
    await expect.element(staticHost.locate(richSelector).first()).toBeInTheDocument()

    const editorRoot = editorHost.locate('.ProseMirror').element()
    const staticRoot = staticHost.locate('.ProseMirror').element()
    expect(canonicalize(staticRoot)).toBe(canonicalize(editorRoot))
  })

  it('matches the editor for inline math', async () => {
    const markdown = 'a $E=mc^2$ b'
    await render(
      <div data-testid="parity-editor">
        <ProseKitEditor initialMarkdown={markdown} markMode="hide" readOnly />
      </div>,
    )
    await render(
      <div data-testid="parity-static">
        <MarkdownView markdown={markdown} />
      </div>,
    )
    // KaTeX renders asynchronously in both hosts; wait for each before diffing.
    await expect.element(editorHost.locate('.katex').first()).toBeInTheDocument()
    await expect.element(staticHost.locate('.katex').first()).toBeInTheDocument()

    const editorRoot = editorHost.locate('.ProseMirror').element()
    const staticRoot = staticHost.locate('.ProseMirror').element()
    expect(canonicalize(staticRoot)).toBe(canonicalize(editorRoot))
  })

  it('matches the editor for a Mermaid diagram', async () => {
    const markdown = 'before\n\n```mermaid\nflowchart LR\n  A[Start] --> B[End]\n```'
    await render(
      <div data-testid="parity-editor">
        <ProseKitEditor initialMarkdown={markdown} markMode="hide" readOnly />
      </div>,
    )
    await render(
      <div data-testid="parity-static">
        <MarkdownView markdown={markdown} />
      </div>,
    )
    const editorPreview = editorHost.getByTestId('code-block-mermaid-preview')
    const staticPreview = staticHost.getByTestId('code-block-mermaid-preview')
    await expect.element(editorPreview.locate('svg'), { timeout: 15000 }).toBeInTheDocument()
    await expect.element(staticPreview.locate('svg'), { timeout: 15000 }).toBeInTheDocument()

    expect(canonicalize(staticPreview.element())).toBe(canonicalize(editorPreview.element()))
  })
})
