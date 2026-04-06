import { ToolRegistry } from './toolRegistry'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

const tests: Array<{ name: string; fn: () => Promise<void> | void }> = [
  {
    name: 'executes registered tool',
    fn: async () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'echo',
        description: 'Echo text',
        execute: async (input) => ({
          success: true,
          content: String(input.text ?? ''),
        }),
      })

      const result = await registry.execute('echo', { text: 'hello' })
      assert(result.success, 'expected successful tool execution')
      assert(result.content === 'hello', 'expected echoed content')
    },
  },
  {
    name: 'returns failure for unknown tool',
    fn: async () => {
      const registry = new ToolRegistry()
      const result = await registry.execute('missing', {})
      assert(!result.success, 'expected unknown tool to fail')
      assert(result.content.includes('Unknown tool'), 'expected unknown-tool message')
    },
  },
  {
    name: 'converts thrown error into failure result',
    fn: async () => {
      const registry = new ToolRegistry()
      registry.register({
        name: 'boom',
        description: 'Throws',
        execute: async () => {
          throw new Error('boom')
        },
      })

      const result = await registry.execute('boom', {})
      assert(!result.success, 'expected thrown error to become failure result')
      assert(result.content === 'boom', 'expected thrown error message')
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
    process.stderr.write('\nTool registry harness failed.\n')
  } else {
    process.stdout.write('\nTool registry harness passed.\n')
  }
}

void run()


