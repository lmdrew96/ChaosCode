export interface ParsedFile {
  path: string
  content: string
}

export interface ReviewResult {
  severity: 'none' | 'minor' | 'breaking'
  issues: string[]
  fixedContent: string | null
}

export interface ParsedToolCall {
  id: string
  name: string
  input: Record<string, unknown>
}

/**
 * Strips markdown code fences from file content.
 * Haiku often wraps content in ```lang ... ``` even inside <file> blocks.
 * Only strips when the ENTIRE content is one fence wrapper with no inner fences
 * (avoids corrupting .md files or other files that legitimately contain code blocks).
 */
function stripFences(content: string): string {
  const trimmed = content.trim()
  const outerMatch = trimmed.match(/^```[\w.-]*\n([\s\S]*)\n```$/)
  if (!outerMatch) return trimmed
  const inner = outerMatch[1]
  // If inner content has lines starting with ``` it's a nested structure — leave it alone
  if (/^```/m.test(inner)) return trimmed
  return inner
}

/**
 * Sonnet may wrap fixes in code fences or an accidental <file> wrapper.
 * Normalize to raw file content before writing to disk.
 */
function normalizeFixedContent(content: string): string {
  const noFences = stripFences(content)
  const fileMatch = noFences.match(/<file\s+path="[^"]+">([\s\S]*?)<\/file>/i)
  return (fileMatch?.[1] ?? noFences).trim()
}

/**
 * Scans accumulated streamed text for completed <file path="...">...</file> blocks.
 * Returns all complete files found and how many characters were consumed.
 */
export function extractCompletedFiles(text: string): {
  files: ParsedFile[]
  consumed: number
} {
  const files: ParsedFile[] = []
  const pattern = /<file\s+path\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/file>/gi
  let lastEnd = 0
  let match: RegExpExecArray | null

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[2].trim()
    files.push({ path: match[1], content: stripFences(raw) })
    lastEnd = match.index + match[0].length
  }

  return { files, consumed: lastEnd }
}

/**
 * Parses completed tool call blocks from streamed text.
 * Supports both:
 * 1) <file path="...">...</file> (mapped to persist_and_review)
 * 2) <tool_use name="..." id="...">{"json":true}</tool_use>
 */
export function parseStreamToolCalls(text: string): {
  calls: ParsedToolCall[]
  consumed: number
} {
  const entries: Array<{ start: number; end: number; call: ParsedToolCall }> = []

  const filePattern = /<file\s+path\s*=\s*["']([^"']+)["']\s*>([\s\S]*?)<\/file>/gi
  let fileMatch: RegExpExecArray | null
  while ((fileMatch = filePattern.exec(text)) !== null) {
    const raw = fileMatch[2].trim()
    entries.push({
      start: fileMatch.index,
      end: fileMatch.index + fileMatch[0].length,
      call: {
        id: `file-${fileMatch.index}`,
        name: 'persist_and_review',
        input: {
          path: fileMatch[1],
          content: stripFences(raw),
        },
      },
    })
  }

  const toolPattern = /<tool_use\s+name\s*=\s*["']([^"']+)["'](?:\s+id\s*=\s*["']([^"']+)["'])?\s*>([\s\S]*?)<\/tool_use>/gi
  let toolMatch: RegExpExecArray | null
  while ((toolMatch = toolPattern.exec(text)) !== null) {
    const rawInput = toolMatch[3].trim()
    let parsedInput: Record<string, unknown> = {}
    if (rawInput.length > 0) {
      try {
        const value = JSON.parse(rawInput)
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          parsedInput = value as Record<string, unknown>
        } else {
          parsedInput = { value }
        }
      } catch {
        parsedInput = { raw: rawInput }
      }
    }

    entries.push({
      start: toolMatch.index,
      end: toolMatch.index + toolMatch[0].length,
      call: {
        id: toolMatch[2] || `tool-${toolMatch.index}`,
        name: toolMatch[1],
        input: parsedInput,
      },
    })
  }

  entries.sort((a, b) => a.start - b.start)
  const calls = entries.map((entry) => entry.call)
  const consumed = entries.length > 0 ? Math.max(...entries.map((entry) => entry.end)) : 0

  return { calls, consumed }
}

/**
 * Parses Sonnet's structured agentic review output.
 */
export function parseReview(text: string): ReviewResult {
  const severityMatch = text.match(/<severity>(none|minor|breaking)<\/severity>/i)
  const issuesMatch = text.match(/<issues>([\s\S]*?)<\/issues>/i)
  const fixedMatch = text.match(/<fixed>([\s\S]*?)<\/fixed>/i)

  const severity = (severityMatch?.[1]?.toLowerCase() as ReviewResult['severity']) ?? 'none'

  const issues = issuesMatch?.[1]
    .split('\n')
    .map((l) => l.replace(/^[-*\d.]\s*/, '').trim())
    .filter(Boolean) ?? []

  const fixedRaw = fixedMatch?.[1]?.trim() ?? ''
  const fixedNormalized = fixedRaw ? normalizeFixedContent(fixedRaw) : ''
  const fixedContent = fixedNormalized.length > 0 ? fixedNormalized : null

  return { severity, issues, fixedContent }
}
