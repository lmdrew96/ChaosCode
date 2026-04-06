export interface ToolDefinition {
  name: string
  description: string
  execute: (input: Record<string, unknown>) => Promise<ToolExecutionResult>
}

export interface ToolExecutionResult {
  success: boolean
  content: string
}

export class ToolRegistry {
  private tools = new Map<string, ToolDefinition>()

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool)
  }

  has(name: string): boolean {
    return this.tools.has(name)
  }

  async execute(name: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    const tool = this.tools.get(name)
    if (!tool) {
      return {
        success: false,
        content: `Unknown tool: ${name}`,
      }
    }

    try {
      return await tool.execute(input)
    } catch (error) {
      return {
        success: false,
        content: error instanceof Error ? error.message : String(error),
      }
    }
  }

  list(): string[] {
    return Array.from(this.tools.keys())
  }
}

