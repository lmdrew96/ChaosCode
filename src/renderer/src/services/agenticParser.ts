export interface ParsedFile {
  path: string
  content: string
}

export interface ReviewResult {
  severity: 'none' | 'minor' | 'breaking'
  issues: string[]
  fixedContent: string | null
}

/**
 * Strips markdown code fences from file content.
 * Haiku often wraps content in ```lang ... ``` even inside <file> blocks.
 */
function stripFences(content: string): string {
  return content
    .trim()
    .replace(/^```[\w]*\n?/, '')  // opening fence
    .replace(/\n?```$/, '')        // closing fence
    .trim()
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
