---
'@meowdown/core': patch
---

Clicking an embed's plain source URL (`remoteMedia: false`) no longer fires `onImageClick`, and a host-rendered embed no longer reports an `<img>` nested in its content as the clicked image element.
