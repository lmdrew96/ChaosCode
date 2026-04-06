import { scheduleToolCalls } from './agenticExecutionLoop'
import { adversarialOutputs } from './__fixtures__/adversarialOutputs'
import { parseStreamToolCalls } from './agenticParser'
import { ToolRegistry } from './toolRegistry'
import type { ParsedToolCall } from './agenticParser'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
  {
    name: 'emits exact tool_use and tool_result callbacks for the mixed fixture',
    fn: async () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'run_check',
        description: 'Run a check',
        execute: async (input) => ({ success: true, content: `checked:${String(input.scope ?? '')}` }),
      })
      registry.register({
        name: 'persist_and_review',
        description: 'Persist file and review it',
        execute: async (input) => ({
          success: true,
          content: `${String(input.path ?? '')}:${String(input.content ?? '')}`,
        }),
      })

      const parsed = parseStreamToolCalls(adversarialOutputs.mixedToolAndFile)
      const calls: ParsedToolCall[] = parsed.calls

      const events: string[] = []

      const scheduled = scheduleToolCalls({
        calls,
        registry,
        onToolUse: (call) => events.push(`use:${call.id}:${call.name}`),
        onToolResult: (call, result) => events.push(`result:${call.id}:${result.success ? 'ok' : 'err'}:${result.content}`),
      })

      await Promise.all(scheduled)

      const expectedFileId = `file-${adversarialOutputs.mixedToolAndFile.indexOf('<file path="src/demo.ts">')}`
      assert(
        events.join(' | ') === [
          'use:check-1:run_check',
          'use:' + expectedFileId + ':persist_and_review',
          'result:check-1:ok:checked:ui',
          'result:' + expectedFileId + ':ok:src/demo.ts:export const demo = 1',
        ].join(' | '),
        'expected exact tool_use/tool_result sequence for the mixed fixture'
      )
    },
  },
  {
    name: 'unknown tools still emit tool_result as failure',
    fn: async () => {
      const registry = new ToolRegistry()
      const calls: ParsedToolCall[] = [
        { id: 'x', name: 'missing', input: {} },
      ]

      let failureSeen = false
      const scheduled = scheduleToolCalls({
        calls,
        registry,
        onToolResult: (_call, result) => {
          failureSeen = !result.success && result.content.includes('Unknown tool')
        },
      })

      await Promise.all(scheduled)
      assert(failureSeen, 'expected failure result callback for unknown tool')
    },
  },
]

async function run(): Promise<void> {
  for (const test of tests) {
    try {
      await test.fn()
      process.stdout.write(`PASS ${test.name}\n`)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      process.stderr.write(`FAIL ${test.name}: ${message}\n`)
      process.exitCode = 1
    }
  }

  if (process.exitCode && process.exitCode !== 0) {
    process.stderr.write('\nAgentic execution loop harness failed.\n')
  } else {
    process.stdout.write('\nAgentic execution loop harness passed.\n')
  }
}

void run()

