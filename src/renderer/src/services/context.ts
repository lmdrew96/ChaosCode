/**
 * Context providers — inspired by Continue's BaseContextProvider pattern.
 * Each function returns ContextItem[] describing one source of context.
 * The protocol layer (buildLLMMessage) serializes them into the final message.
 */

import type { ContextItem, FileNode, OpenFile } from '@/types'

const MAX_CONTEXT_CHARS = 24_000

// ─── Providers ────────────────────────────────────────────────────────────────

/** The currently open file in Monaco */
export function openFileContextItem(file: OpenFile): ContextItem {
  return {
    name: file.path.split('/').pop() ?? file.path,
    description: file.path,
    content: `\`\`\`${file.path}\n${file.content}\n\`\`\``,
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

  const xml = items
    .map((item) => {
      const uriType = item.uri?.type ?? ''
      const uriValue = item.uri?.value ?? ''
      return [
        `<context_item name="${escapeAttr(item.name)}" description="${escapeAttr(item.description)}" uri_type="${escapeAttr(uriType)}" uri_value="${escapeAttr(uriValue)}" editable="${item.editable ? 'true' : 'false'}">`,
        item.content,
        '</context_item>',
      ].join('\n')
    })
    .join('\n\n')

  // Keep a deterministic context cap to reduce model drift on long sessions.
  return xml.length > MAX_CONTEXT_CHARS ? xml.slice(0, MAX_CONTEXT_CHARS) : xml
}

/**
 * Build the full user-facing message string to send to an LLM:
 * user text + serialized context items.
 */
export function buildLLMMessage(userText: string, contextItems: ContextItem[]): string {
  const ctx = serializeContextItems(contextItems)
  return [
    '<chat_input>',
    '<user_request>',
    userText,
    '</user_request>',
    ctx ? `<context_bundle>\n${ctx}\n</context_bundle>` : '',
    '</chat_input>',
  ].filter(Boolean).join('\n')
}

export function buildSonnetReviewMessage(userText: string, contextItems: ContextItem[], haikuReply: string): string {
  const base = buildLLMMessage(userText, contextItems)
  return [
    base,
    '<haiku_draft>',
    haikuReply,
    '</haiku_draft>',
    '<instruction>Review the draft, fix issues directly, and return the final answer.</instruction>',
  ].join('\n\n')
}

function escapeAttr(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
}
