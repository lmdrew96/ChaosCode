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

export interface ToolUsePart {
  type: 'tool_use'
  toolUse: {
    id: string
    name: string
    input: Record<string, unknown>
  }
}

export interface ToolResultPart {
  type: 'tool_result'
  toolResult: {
    toolUseId: string
    content: string
    isError?: boolean
  }
}

export interface TerminalOutputPart {
  type: 'terminal_output'
  terminalOutput: {
    command: string
    stdout: string
    stderr: string
    exitCode: number
  }
}

export type MessagePart = TextPart | ImagePart | ToolUsePart | ToolResultPart | TerminalOutputPart
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
    .map((p) => {
      if (p.type === 'text') return p.text
      if (p.type === 'image') return `[image: ${p.url}]`
      if (p.type === 'tool_use') return `[tool_use: ${p.toolUse.name}]`
      if (p.type === 'terminal_output') return `[$ ${p.terminalOutput.command}]\n${p.terminalOutput.stdout}${p.terminalOutput.stderr ? `\nstderr: ${p.terminalOutput.stderr}` : ''}`
      return `[tool_result: ${p.toolResult.isError ? 'error' : 'ok'}] ${p.toolResult.content}`
    })
    .join('\n')
}
