import type { ParsedToolCall } from '@/services/agenticParser'
import type { ToolExecutionResult, ToolRegistry } from '@/services/toolRegistry'

interface ScheduleArgs {
  calls: ParsedToolCall[]
  registry: ToolRegistry
  onToolUse?: (call: ParsedToolCall) => void
  onToolResult?: (call: ParsedToolCall, result: ToolExecutionResult) => void
}

/**
 * Schedules tool calls immediately and returns their tracked promises.
 * Caller decides whether to await in parallel or serially.
 */
export function scheduleToolCalls({
  calls,
  registry,
  onToolUse,
  onToolResult,
}: ScheduleArgs): Promise<void>[] {
  return calls.map((call) => {
    onToolUse?.(call)

    return registry.execute(call.name, call.input).then((result) => {
      onToolResult?.(call, result)
    })
  })
}

