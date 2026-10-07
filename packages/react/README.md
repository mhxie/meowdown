# @meowdown/react

React components for Meowdown, a hybrid (live-preview) Markdown editor.

[**Live demo**](https://meowdown.vercel.app/)

## Quick start

Install the package and its peer dependencies:

```sh
npm install @meowdown/react @meowdown/core react react-dom
```

Import both stylesheets and render the editor:

```tsx
import '@meowdown/core/style.css'
import '@meowdown/react/style.css'
import { MeowdownEditor } from '@meowdown/react'

export function App() {
  return <MeowdownEditor initialMarkdown="# Hello" />
}
```

## Usage

```tsx
import { MeowdownEditor, type EditorHandle } from '@meowdown/react'
import { useRef, useCallback } from 'react'

export function App() {
  const ref = useRef<EditorHandle>(null)
  const handleDocChange = useCallback(() => {
    console.log(ref.current?.getMarkdown())
  }, [])

  return (
    <MeowdownEditor
      handleRef={ref}
      mode="focus"
      initialMarkdown="# Hello"
      onDocChange={handleDocChange}
    />
  )
}
```

## Components

| Component                                                            | Description                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `MeowdownEditor`                                                     | The editor. Callbacks and resolvers must be stable; pass them via `useCallback`.                                                                                                                                                                                                     |
| `MarkdownView`                                                       | Read-only Markdown renderer. `interactive={false}` renders passive content for previews.                                                                                                                                                                                             |
| `WikilinkHoverCard`                                                  | Mount inside `MeowdownEditor`; renders host content for the hovered wiki link's `target`. Return `null` to render no card.                                                                                                                                                           |
| `LightboxRoot` / `LightboxImage` / `LightboxVideo` / `LightboxFrame` | Full-window image, video, and embedded player preview driven by `useLightbox()`. Compose your own close controls inside `LightboxRoot`, and call `lightbox.open(item, element)` from `onImageClick`, `onXPostMediaClick`, or `onYouTubeVideoClick` to zoom from the clicked element. |

Common `MeowdownEditor` props:

| Prop                                                                                                                            | What it does                                                                       |
| ------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `mode`                                                                                                                          | `'focus'` (default), `'show'`, or `'hide'`: how much Markdown syntax stays in view |
| `searchQuery` / `onSearchChange`                                                                                                | Find in document, with `EditorHandle.findNext()` / `findPrevious()`                |
| `onWikilinkClick` / `onLinkClick` / `onTagClick` / `onImageClick` / `onFileClick` / `onXPostMediaClick` / `onYouTubeVideoClick` | Click handling for the rendered atoms                                              |
| `resolveImageUrl` / `resolveWikiEmbed` / `resolveWikilink` / `resolveFileLink` / `resolveFileInfo`                              | Resolve and classify local content                                                 |
| `onFilePaste`                                                                                                                   | Persist pasted or dropped files                                                    |
| `onSlashMenuSearch` / `onTagSearch` / `onWikilinkSearch` / `onSelectionMenuSearch`                                              | Search menus for `/`, `#`, `[[`, and selection commands                            |
| `readOnly` / `placeholder` / `blockHandle` / `caretGlide` / `embedPaste` / `linkPaste` / `bulletAfterHeading`                   | Behavior toggles                                                                   |
| `CodeBlockView`                                                                                                                 | Custom React node view component for code blocks                                   |

Every prop, callback, and `EditorHandle` method is documented in the [API reference](https://npmx.dev/package-docs/@meowdown%2Freact/).

`MarkdownView` also accepts `renderBlock`, a pure `MarkdownBlockRenderer`.
Its context contains the ProseMirror `node`, `interactive`, and a lazy
`renderDefault()` for composing the built-in presentation. Return `undefined`
for normal rendering or `null` to omit a block. `node.textContent` retains
inline Markdown or the code body; code blocks expose `node.attrs.language`.
The hook applies to nested blocks too. Honor `interactive` in custom controls,
and do not use callback order to assign reference numbers: memoized blocks can
render independently. Output may depend only on the block, its `position`, and
its `previousSibling`/`nextSibling`; `doc` locates the block but other blocks
in it do not trigger a re-render. Wikilink metadata and numbered reference appearance work
the same in `MarkdownView`, `MarkdownInlineView`, and the editor.

## Styling

Import both stylesheets: `@meowdown/core/style.css` (the editor theme and variables) and `@meowdown/react/style.css` (the component layout). The core theme is documented in [`@meowdown/core`](https://www.npmjs.com/package/@meowdown/core).

## License

MIT
