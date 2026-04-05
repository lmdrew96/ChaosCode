import { adversarialOutputs } from './__fixtures__/adversarialOutputs'
import { extractCompletedFiles, parseReview } from './agenticParser'
import { validateAgenticOutput } from './agenticSecurity'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void): void {
  try {
    fn()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`FAIL ${name}: ${message}\n`)
    process.exitCode = 1
  }
}

test('extractCompletedFiles parses mixed-case and single-quoted path tags', () => {
  const result = extractCompletedFiles(adversarialOutputs.mixedCaseFileTags)
  assert(result.files.length === 1, 'expected one parsed file')
  assert(result.files[0].path === 'src/demo.ts', 'expected normalized path value from XML attribute')
  assert(result.files[0].content.includes('export const demo = 1'), 'expected code fences stripped')
})

test('parseReview strips fenced content inside <fixed>', () => {
  const review = parseReview(adversarialOutputs.reviewWithFencedFix)
  assert(review.severity === 'minor', 'expected severity=minor')
  assert(review.fixedContent === 'export const x = 1', 'expected normalized fixed content')
})

test('validateAgenticOutput blocks path traversal writes', () => {
  const traversal = extractCompletedFiles(adversarialOutputs.traversalFileTag).files[0]
  const result = validateAgenticOutput({
    rootPath: '/tmp/project',
    filePath: traversal.path,
    content: traversal.content,
  })
  assert(!result.isValid, 'expected validation failure for traversal')
  assert(result.reasons.some((reason) => reason.includes('Path traversal')), 'expected traversal reason')
})

test('validateAgenticOutput blocks absolute paths', () => {
  const absolute = extractCompletedFiles(adversarialOutputs.absoluteFileTag).files[0]
  const result = validateAgenticOutput({
    rootPath: '/tmp/project',
    filePath: absolute.path,
    content: absolute.content,
  })
  assert(!result.isValid, 'expected validation failure for absolute path')
  assert(result.reasons.some((reason) => reason.includes('relative')), 'expected relative path reason')
})

test('validateAgenticOutput warns on secret-like content', () => {
  const suspicious = extractCompletedFiles(adversarialOutputs.suspiciousSecretContent).files[0]
  const result = validateAgenticOutput({
    rootPath: '/tmp/project',
    filePath: suspicious.path,
    content: suspicious.content,
  })
  assert(result.isValid, 'secret-like text alone should warn, not block')
  assert(result.warnings.length > 0, 'expected secret-like warning')
})

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write('\nPrompt security harness failed.\n')
} else {
  process.stdout.write('\nPrompt security harness passed.\n')
}

