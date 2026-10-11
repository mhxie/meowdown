---
'@meowdown/markdown': patch
---

Parse long paragraphs in linear time: the bare-domain and `scheme://` autolink parsers test the character before a word by its code and check for an open link only after a match, so they no longer scan the paragraph's parsed elements at every letter.
