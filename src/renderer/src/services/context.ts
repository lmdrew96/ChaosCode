/**
 * Context providers — inspired by Continue's BaseContextProvider pattern.
 * Each function returns ContextItem[] describing one source of context.
 * The protocol layer (buildLLMMessage) serializes them into the final message.
 */

import type { ContextItem, FileNode, OpenFile } from '@/types'

// ─── Providers ────────────────────────────────────────────────────────────────

/** The currently open file in Monaco */
export function openFileContextItem(file: OpenFile): ContextItem {
  return {
    name: file.path.split('/').pop() ?? file.path,
    description: file.path,
    content: `\`\`\`${file.language}\n${file.content}\n\`\`\``,
    uri: { type: 'file', value: file.path },
    editable: true,
  }
}

/** Flat text representation of the project file tree */
export function fileTreeContextItem(nodes: FileNode[], rootPath: string): ContextItem {
  return {
    name: 'Project files',
    description: rootPath,
    content: renderTree(nodes, 0),
    uri: { type: 'directory', value: rootPath },
  }
}

function renderTree(nodes: FileNode[], depth: number): string {
  return nodes
    .map((n) => {
      const indent = '  '.repeat(depth)
      if (n.type === 'directory') {
        const children = n.children ? renderTree(n.children, depth + 1) : ''
        return `${indent}${n.name}/\n${children}`
      }
      return `${indent}${n.name}`
    })
    .join('\n')
}

// ─── Serialization ─────────────────────────────────────────────────────────────

/**
 * Serialize ContextItem[] into the string that gets appended to the user's
 * message before it's sent to an LLM.
 *
 * Format mirrors Continue: each item is a titled block so the model can
 * distinguish between context sources.
 */
export function serializeContextItems(items: ContextItem[]): string {
  if (items.length === 0) return ''
  return items
    .map((item) => `[Context: ${item.name}]\n${item.content}`)
    .join('\n\n')
}

/**
 * Build the full user-facing message string to send to an LLM:
 * user text + serialized context items.
 */
export function buildLLMMessage(userText: string, contextItems: ContextItem[]): string {
  const ctx = serializeContextItems(contextItems)
  if (!ctx) return userText
  return `${userText}\n\n---\n${ctx}`
}
