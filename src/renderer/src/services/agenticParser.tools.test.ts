import { adversarialOutputs } from './__fixtures__/adversarialOutputs'
import { parseStreamToolCalls } from './agenticParser'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const tests: Array<{ name: string; fn: () => void }> = [
  {
    name: 'maps mixed tool/file fixture to exact parsed calls',
    fn: () => {
      const input = adversarialOutputs.mixedToolAndFile
      const parsed = parseStreamToolCalls(input)
      const expectedFileId = `file-${input.indexOf('<file path="src/demo.ts">')}`

      assert(parsed.calls.length === 2, 'expected two parsed calls')
      assert(parsed.calls[0].id === 'check-1', 'expected explicit tool id')
      assert(parsed.calls[0].name === 'run_check', 'expected explicit tool name')
      assert(parsed.calls[0].input.scope === 'ui', 'expected exact JSON payload')
      assert(parsed.calls[1].id === expectedFileId, 'expected deterministic file call id')
      assert(parsed.calls[1].name === 'persist_and_review', 'expected mapped file tool name')
      assert(parsed.calls[1].input.path === 'src/demo.ts', 'expected exact file path')
      assert(parsed.calls[1].input.content === 'export const demo = 1', 'expected exact file content')
      assert(parsed.consumed === input.length, 'expected exact consumed span')
    },
  },
  {
    name: 'falls back to raw content when <tool_use> JSON is malformed',
    fn: () => {
      const input = '<tool_use name="run_check">{scope: ui}</tool_use>'
      const parsed = parseStreamToolCalls(input)

      assert(parsed.calls.length === 1, 'expected one parsed tool call')
      assert(parsed.calls[0].name === 'run_check', 'expected explicit tool name')
      assert(parsed.calls[0].input.raw === '{scope: ui}', 'expected raw fallback payload')
    },
  },
  {
    name: 'generates a stable fallback id when <tool_use> omits one',
    fn: () => {
      const input = '<tool_use name="run_check">{"scope":"ui"}</tool_use>'
      const parsed = parseStreamToolCalls(input)

      assert(parsed.calls.length === 1, 'expected one parsed tool call')
      assert(parsed.calls[0].id.startsWith('tool-'), 'expected generated fallback id')
      assert(parsed.calls[0].input.scope === 'ui', 'expected parsed JSON input')
    },
  },
  {
    name: 'preserves call ordering across mixed block types',
    fn: () => {
      const input = [
        '<tool_use name="first" id="1">{"a":1}</tool_use>',
        '<file path="src/a.ts">export const a = 1</file>',
        '<tool_use name="third" id="3">{"c":3}</tool_use>',
      ].join('\n')

      const parsed = parseStreamToolCalls(input)
      const expectedFileId = `file-${input.indexOf('<file path="src/a.ts">')}`

      assert(parsed.calls.length === 3, 'expected three calls')
      assert(parsed.calls[0].id === '1', 'expected first explicit tool id')
      assert(parsed.calls[1].id === expectedFileId, 'expected deterministic file id in the middle')
      assert(parsed.calls[2].id === '3', 'expected third explicit tool id')
    },
  },
]

for (const test of tests) {
  try {
    test.fn()
    process.stdout.write(`PASS ${test.name}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`FAIL ${test.name}: ${message}\n`)
    process.exitCode = 1
  }
}

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write('\nAgentic parser tool-call harness failed.\n')
} else {
  process.stdout.write('\nAgentic parser tool-call harness passed.\n')
}

