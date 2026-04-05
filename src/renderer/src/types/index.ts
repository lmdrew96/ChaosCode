// ─── Message content ──────────────────────────────────────────────────────────
// Inspired by Continue's MessageContent — supports plain text today,
// multimodal (image parts) tomorrow.

export interface TextPart {
  type: 'text'
  text: string
}

export interface ImagePart {
  type: 'image'
  url: string
}

export type MessagePart = TextPart | ImagePart
export type MessageContent = string | MessagePart[]

// ─── Context items ────────────────────────────────────────────────────────────
// Structured context attached to a message, mirroring Continue's ContextItem.
// Each provider (open file, file tree, selected code…) returns ContextItem[].
// They are serialized into the LLM message separately from the user's text.

export interface ContextItemUri {
  type: 'file' | 'directory' | 'url'
  value: string
}

export interface ContextItem {
  name: string
  description: string
  content: string        // Ready-to-inject string (already formatted)
  uri?: ContextItemUri
  editable?: boolean     // Whether the user can edit this file from the IDE
}

// ─── Chat history ─────────────────────────────────────────────────────────────
// Continue's ChatHistoryItem pattern: message + the context that was active
// when it was sent. Keeps messages clean and context auditable.

export type MessageSource = 'haiku' | 'sonnet'
export type LLMTarget = 'both' | 'haiku' | 'sonnet'

export interface Message {
  id: string
  role: 'user' | 'assistant'
  content: MessageContent
  source?: MessageSource
  timestamp: number
}

export interface ChatHistoryItem {
  message: Message
  contextItems: ContextItem[]
}

// ─── Review ────────────────────────────────────────────────────────────────────

export interface ReviewEntry {
  id: string
  severity: 'minor' | 'breaking'
  description: string
  timestamp: number
}

// ─── File system ──────────────────────────────────────────────────────────────

export interface FileDiffSummary {
  added: number
  removed: number
}

export interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface OpenFile {
  path: string
  content: string
  language: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Coerce MessageContent to a plain string for LLM API calls */
export function contentToString(content: MessageContent): string {
  if (typeof content === 'string') return content
  return content
    .map((p) => (p.type === 'text' ? p.text : `[image: ${p.url}]`))
    .join('\n')
}
