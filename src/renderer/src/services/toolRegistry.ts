export interface ToolDefinition {
  name: string
  /**
   * Full description used to generate the <available_tools> block sent to the model.
   * For model-facing tools, include the name, input schema, use-for list, and rules.
   * For internal tools (internal: true), this field is ignored in docs generation.
   */
  description: string
  /** If true, this tool is not exposed in the model's <available_tools> context. */
  internal?: boolean
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

  /**
   * Returns a formatted string of all public (non-internal) tool descriptions,
   * suitable for injection into an <available_tools> block in a system prompt.
   */
  listPublicDocs(): string {
    return Array.from(this.tools.values())
      .filter((t) => !t.internal)
      .map((t) => t.description)
      .join('\n')
  }
}

