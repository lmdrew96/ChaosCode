export interface AgenticOutputValidationInput {
  rootPath: string
  filePath: string
  content: string
}

export interface AgenticOutputValidationResult {
  isValid: boolean
  normalizedPath: string
  warnings: string[]
  reasons: string[]
}

const MAX_FILE_CHARS = 500_000

const secretLikePatterns: RegExp[] = [
  /api[_-]?key\s*[:=]\s*['\"]?[a-z0-9_\-]{16,}['\"]?/i,
  /aws_access_key_id\s*[:=]\s*['\"]?akia[0-9a-z]{16}['\"]?/i,
  /secret(_|\s)?key\s*[:=]\s*['\"][^'\"]{8,}['\"]/i,
  /anthropic[_-]?api[_-]?key\s*[:=]\s*['\"][^'\"]+['\"]/i,
]

function normalizeRelativePath(filePath: string): string {
  return filePath
    .replaceAll('\\', '/')
    .replace(/^~/, '/~') // expand leading ~ so isAbsolutePath catches it via startsWith('/')
    .replace(/^\.\//, '')
    .replace(/\/+/g, '/')
    .trim()
}

function hasPathTraversal(pathValue: string): boolean {
  return pathValue.split('/').some((part) => part === '..')
}

function isAbsolutePath(pathValue: string): boolean {
  return pathValue.startsWith('/') || /^[A-Za-z]:\//.test(pathValue) || pathValue.startsWith('~')
}

export function validateAgenticOutput(input: AgenticOutputValidationInput): AgenticOutputValidationResult {
  const normalizedPath = normalizeRelativePath(input.filePath)
  const reasons: string[] = []
  const warnings: string[] = []

  if (!normalizedPath) reasons.push('File path is empty.')
  if (isAbsolutePath(normalizedPath)) reasons.push('File path must be relative to the project root.')
  if (hasPathTraversal(normalizedPath)) reasons.push('Path traversal (..) is not allowed.')
  if (normalizedPath.includes('\u0000')) reasons.push('File path contains a null byte.')
  if (input.content.includes('\u0000')) reasons.push('File content contains a null byte (possible binary payload).')
  if (input.content.length > MAX_FILE_CHARS) {
    reasons.push(`File content exceeds safety limit (${MAX_FILE_CHARS} characters).`)
  }

  const lowered = normalizedPath.toLowerCase()
  if (lowered === '.env' || lowered.endsWith('/.env') || lowered.includes('.env.')) {
    warnings.push('Output targets a .env-like file; verify no secrets are being introduced.')
  }

  if (secretLikePatterns.some((pattern) => pattern.test(input.content))) {
    warnings.push('Content looks like it may contain credentials or tokens.')
  }

  return {
    isValid: reasons.length === 0,
    normalizedPath,
    warnings,
    reasons,
  }
}

export function formatValidationSummary(result: AgenticOutputValidationResult): string {
  if (result.isValid) {
    if (result.warnings.length === 0) return ''
    return `Warnings for ${result.normalizedPath}: ${result.warnings.join(' ')}`
  }
  return `Blocked write to ${result.normalizedPath || '[unknown path]'}: ${result.reasons.join(' ')}`
}

