import { extractCompletedFiles } from './agenticParser'
import { selectNewCompletedFiles } from './agenticStreamState'

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

test('selectNewCompletedFiles drops duplicate path+content blocks', () => {
  const input = [
    { path: 'src/a.ts', content: 'export const a = 1' },
    { path: 'src/a.ts', content: 'export const a = 1' },
  ]

  const result = selectNewCompletedFiles(input, {})
  assert(result.files.length === 1, 'expected one unique file block')
  assert(result.nextState['src/a.ts'] === 'export const a = 1', 'expected state to track last queued content')
})

test('selectNewCompletedFiles allows same path when content changes', () => {
  const first = selectNewCompletedFiles([{ path: 'src/a.ts', content: 'v1' }], {})
  const second = selectNewCompletedFiles([{ path: 'src/a.ts', content: 'v2' }], first.nextState)

  assert(first.files.length === 1, 'expected first content version to be queued')
  assert(second.files.length === 1, 'expected changed content version to be queued')
  assert(second.nextState['src/a.ts'] === 'v2', 'expected state to update to latest content')
})

test('dedupe handles incremental parse plus post-stream parse overlap', () => {
  const full = [
    '<file path="src/demo.ts">',
    'export const demo = 1',
    '</file>',
  ].join('\n')

  const incremental = extractCompletedFiles(full)
  const firstPass = selectNewCompletedFiles(incremental.files, {})
  const secondParse = extractCompletedFiles(full.slice(incremental.consumed))
  const secondPass = selectNewCompletedFiles(secondParse.files, firstPass.nextState)

  assert(firstPass.files.length === 1, 'expected file to be queued during incremental pass')
  assert(secondPass.files.length === 0, 'expected overlapping post-stream parse to dedupe out')
})

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write('\nAgentic stream state harness failed.\n')
} else {
  process.stdout.write('\nAgentic stream state harness passed.\n')
}

