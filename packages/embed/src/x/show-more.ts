/**
 * Show the "Show more" button while the line clamp hides part of the main
 * body, and toggle the clamp when it is clicked. Returns the cleanup.
 */
export function setupShowMore(container: HTMLElement): (() => void) | undefined {
  const article = container.querySelector<HTMLElement>(':scope > article')
  const body = article?.querySelector<HTMLElement>(':scope > [data-body]')
  const button = article?.querySelector<HTMLButtonElement>(':scope > [data-show-more]')
  if (!article || !body || !button) return

  const observer = new ResizeObserver(() => {
    if (article.hasAttribute('data-expanded')) return
    button.hidden = body.scrollHeight <= body.clientHeight
  })
  observer.observe(body)

  button.addEventListener('click', () => {
    const expanded = !article.hasAttribute('data-expanded')
    article.toggleAttribute('data-expanded', expanded)
    button.setAttribute('aria-expanded', String(expanded))
    button.textContent = expanded ? 'Show less' : 'Show more'
    // "Show less" can sit far below the post's start; keep it on screen
    // once the body shrinks back.
    if (!expanded) button.scrollIntoView({ block: 'nearest' })
  })

  return () => observer.disconnect()
}
