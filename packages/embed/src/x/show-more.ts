import el from 'crelt'

function renderShowMore(article: HTMLElement): HTMLButtonElement {
  const button = el(
    'button',
    { type: 'button', 'data-show-more': '', 'aria-expanded': 'false' },
    'Show more',
  )
  button.addEventListener('click', () => {
    const expanded = !article.hasAttribute('data-expanded')
    article.toggleAttribute('data-expanded', expanded)
    button.setAttribute('aria-expanded', String(expanded))
    button.textContent = expanded ? 'Show less' : 'Show more'
    // "Show less" can sit far below the post's start; keep it on screen
    // once the body shrinks back.
    if (!expanded) button.scrollIntoView({ block: 'nearest' })
  })
  return button
}

/**
 * Add a "Show more" button while the line clamp hides part of the main body,
 * and remove it once the whole body fits. Returns the cleanup.
 */
export function setupShowMore(container: HTMLElement): (() => void) | undefined {
  const article = container.querySelector<HTMLElement>(':scope > article:not([data-fallback])')
  const body = article?.querySelector<HTMLElement>(':scope > [data-body]')
  if (!article || !body) return

  let button: HTMLButtonElement | undefined
  const observer = new ResizeObserver(() => {
    if (article.hasAttribute('data-expanded')) return
    const clamped = body.scrollHeight > body.clientHeight
    if (clamped && !button) {
      button = renderShowMore(article)
      body.after(button)
    } else if (!clamped && button) {
      button.remove()
      button = undefined
    }
  })
  observer.observe(body)
  return () => observer.disconnect()
}
