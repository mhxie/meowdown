import { defineClipboardSerializer, type PlainExtension } from '@prosekit/core'
import { DOMSerializer } from '@prosekit/pm/model'
import type { DOMOutputSpec, ProseMirrorNode, Schema } from '@prosekit/pm/model'

import { headingClipboardDOM } from '../heading.ts'
import type { NodeName } from '../node-names.ts'
import { paragraphClipboardDOM } from '../paragraph.ts'

import { REFERENCE_DATA, copiedReferenceDefinitions } from './reference-transport.ts'

type NodeSerializers = Record<string, (node: ProseMirrorNode) => DOMOutputSpec>

function withSemanticTextblocks(nodes: NodeSerializers): NodeSerializers {
  return {
    ...nodes,
    ['paragraph' satisfies NodeName]: (node) => ({ dom: paragraphClipboardDOM(node) }),
    ['heading' satisfies NodeName]: (node) => ({ dom: headingClipboardDOM(node) }),
  }
}

/**
 * Semantic HTML carries original source and only the copied references.
 */
export function defineSemanticClipboardSerializer(): PlainExtension {
  return defineClipboardSerializer({
    serializeFragmentWrapper: (serializeFragment) => {
      return (...args) => {
        const fragment = serializeFragment(...args)
        for (const child of fragment.children) child.setAttribute('data-meowdown', '')
        const definitions = copiedReferenceDefinitions(args[0])
        if (definitions?.length)
          fragment.firstElementChild?.setAttribute(REFERENCE_DATA, JSON.stringify(definitions))
        return fragment
      }
    },
    nodesFromSchemaWrapper: (nodesFromSchema) => {
      return (...args) => {
        return withSemanticTextblocks(nodesFromSchema(...args))
      }
    },
  })
}

const semanticSerializerCache = new WeakMap<Schema, DOMSerializer>()

/**
 * Also used when converting foreign HTML into source-preserving clipboard HTML.
 */
export function getSemanticDOMSerializer(schema: Schema): DOMSerializer {
  let serializer = semanticSerializerCache.get(schema)
  if (serializer == null) {
    serializer = new DOMSerializer(
      withSemanticTextblocks(DOMSerializer.nodesFromSchema(schema)),
      DOMSerializer.marksFromSchema(schema),
    )
    semanticSerializerCache.set(schema, serializer)
  }
  return serializer
}
