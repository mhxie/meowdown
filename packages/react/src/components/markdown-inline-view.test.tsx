import '../testing/index.ts'

import { expect, it } from 'vitest'
import { render } from 'vitest-browser-react'
import { page } from 'vitest/browser'

import { MarkdownInlineView } from './markdown-view.tsx'

it('renders paragraph marks with external reference definitions', async () => {
  await render(
    <div data-testid="inline-view">
      <MarkdownInlineView
        markdown={'# **first\nsecond** [link][ref]'}
        referenceDefinitions={
          new Map([['REF', { key: 'REF', href: 'https://example.com', title: '' }]])
        }
      />
    </div>,
  )
  const view = page.getByTestId('inline-view')
  await expect.element(view.locate('p')).toHaveTextContent('# **first second** [link][ref]')
  await expect.element(view.locate('strong')).toHaveTextContent('**first second**')
  await expect.element(view.getByRole('link')).toHaveAttribute('href', 'https://example.com')
})
