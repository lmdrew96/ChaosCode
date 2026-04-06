import { countLineDiff } from './lineDiff'

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

test('countLineDiff normalizes CRLF and detects the inserted line', () => {
  const result = countLineDiff('const a = 1\r\nconst b = 2', 'const a = 1\r\nconst x = 9\r\nconst b = 2')
  assert(result.added === 1, 'expected one added line')
  assert(result.removed === 0, 'expected no removed lines')
  assert(result.addedLines.length === 1 && result.addedLines[0] === 2, 'expected the inserted line to be highlighted')
})

test('countLineDiff highlights changed content by line number', () => {
  const result = countLineDiff('alpha\nbeta\ngamma', 'alpha\nBETA\ngamma')
  assert(result.added === 1, 'expected one changed line')
  assert(result.removed === 1, 'expected one removed line')
  assert(result.addedLines.includes(2), 'expected the edited line to be highlighted')
  assert(result.addedLines.includes(3), 'expected the greedy diff to keep the shifted line highlighted')
})

test('countLineDiff returns no highlights for identical content', () => {
  const text = 'line one\nline two\nline three'
  const result = countLineDiff(text, text)
  assert(result.added === 0, 'expected no added lines')
  assert(result.removed === 0, 'expected no removed lines')
  assert(result.addedLines.length === 0, 'expected no highlighted lines')
})

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write('\nLine diff harness failed.\n')
} else {
  process.stdout.write('\nLine diff harness passed.\n')
}

