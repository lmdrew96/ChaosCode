# Implementation Guide: Adopting Continue Patterns in ChaosCode

## Executive Overview

The Continue repository provides battle-tested patterns for building agentic AI workflows. This guide shows exactly how to apply them to ChaosCode.

---

## Section 1: Streaming Message Display

### Continue's Approach
Messages stream token-by-token from LLM, updating UI in real-time.

### For ChaosCode

**Current:** Messages likely load fully before displaying  
**Better:** Stream tokens and display immediately

**Implementation:**

```typescript
// 1. Create src/services/streamingService.ts
export async function* streamMessage(userMessage: string) {
  const response = await fetch('/api/chat', {
    method: 'POST',
    body: JSON.stringify({ message: userMessage }),
  });
  
  // Read stream as text
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    yield decoder.decode(value); // Yield each chunk
  }
}

// 2. In LLMPanel, connect streaming to UI
async function handleUserMessage(text: string) {
  dispatch(addMessage({ role: 'user', content: text }));
  
  const assistantId = uuidv4();
  dispatch(addMessage({ 
    id: assistantId, 
    role: 'assistant', 
    content: '',
    streaming: true 
  }));
  
  try {
    for await (const chunk of streamMessage(text)) {
      dispatch(updateMessage({
        id: assistantId,
        append: chunk, // Append to existing content
      }));
    }
  } catch (error) {
    dispatch(setMessageError({ id: assistantId, error }));
  } finally {
    dispatch(completeMessage(assistantId));
  }
}
```

---

## Section 2: Redux State Management

### Why Redux?
- Predictable state updates
- Time-travel debugging
- Incremental UI updates
- Easy to test

### For ChaosCode

**Create:** `src/store/chatSlice.ts`

```typescript
import { createSlice, PayloadAction } from '@reduxjs/toolkit';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streaming?: boolean;
  steps?: Step[];
}

interface Step {
  id: string;
  toolName: string;
  input: Record<string, unknown>;
  result?: string;
  error?: string;
}

const chatSlice = createSlice({
  name: 'chat',
  initialState: {
    messages: [] as Message[],
    loading: false,
  },
  reducers: {
    addMessage: (state, action: PayloadAction<Message>) => {
      state.messages.push(action.payload);
    },
    updateMessage: (state, action: PayloadAction<{
      id: string;
      append?: string;
      streaming?: boolean;
    }>) => {
      const msg = state.messages.find(m => m.id === action.payload.id);
      if (msg) {
        if (action.payload.append) {
          msg.content += action.payload.append;
        }
        if (action.payload.streaming !== undefined) {
          msg.streaming = action.payload.streaming;
        }
      }
    },
    addStep: (state, action: PayloadAction<{
      messageId: string;
      step: Step;
    }>) => {
      const msg = state.messages.find(m => m.id === action.payload.messageId);
      if (msg) {
        msg.steps ??= [];
        msg.steps.push(action.payload.step);
      }
    },
    updateStep: (state, action: PayloadAction<{
      messageId: string;
      stepId: string;
      result: string;
      error?: string;
    }>) => {
      const msg = state.messages.find(m => m.id === action.payload.messageId);
      const step = msg?.steps?.find(s => s.id === action.payload.stepId);
      if (step) {
        step.result = action.payload.result;
        step.error = action.payload.error;
      }
    },
  },
});

export default chatSlice.reducer;
```

---

## Section 3: Tool Registry System

### Continue's Pattern
Tools are registered dynamically, not hardcoded.

### For ChaosCode

**Create:** `src/services/toolRegistry.ts`

```typescript
interface Tool {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute: (input: Record<string, unknown>) => Promise<string>;
}

class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(name: string, tool: Tool): void {
    this.tools.set(name, tool);
  }

  async execute(name: string, input: Record<string, unknown>): Promise<{
    success: boolean;
    content?: string;
    error?: string;
  }> {
    const tool = this.tools.get(name);
    if (!tool) {
      return { success: false, error: `Unknown tool: ${name}` };
    }

    try {
      const result = await tool.execute(input);
      return { success: true, content: result };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  getAll(): Tool[] {
    return Array.from(this.tools.values());
  }
}

export const toolRegistry = new ToolRegistry();

// Register tools
toolRegistry.register('file_read', {
  name: 'file_read',
  description: 'Read a file from the project',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path' }
    }
  },
  execute: async (input) => {
    // Implement actual file reading with security checks
    return readFileContent(input.path as string);
  }
});

toolRegistry.register('code_edit', {
  name: 'code_edit',
  description: 'Edit code in a file',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string' },
      startLine: { type: 'number' },
      endLine: { type: 'number' },
      newCode: { type: 'string' }
    }
  },
  execute: async (input) => {
    return editCodeInFile(input as any);
  }
});
```

---

## Section 4: Agentic Loop (Tool Call Parsing & Execution)

### How It Works
1. Send message to LLM with tools definition
2. LLM returns text + tool calls
3. Parse tool calls from response
4. Execute tools
5. Feed results back to LLM
6. Repeat until done

### For ChaosCode

**Create:** `src/services/agentLoop.ts`

```typescript
export async function* executeAgentLoop(
  userMessage: string,
  llmProvider: LLMProvider,
  toolRegistry: ToolRegistry
) {
  const messages: ChatMessage[] = [];
  messages.push({ role: 'user', content: userMessage });

  let turnCount = 0;
  const maxTurns = 10; // Prevent infinite loops

  while (turnCount < maxTurns) {
    turnCount++;

    // Call LLM
    const toolDefinitions = toolRegistry.getAll().map(t => ({
      name: t.name,
      description: t.description,
      parameters: t.parameters,
    }));

    let response = '';
    for await (const chunk of llmProvider.stream(messages, toolDefinitions)) {
      response += chunk;
      yield { type: 'text', content: chunk }; // Stream to UI
    }

    messages.push({ role: 'assistant', content: response });

    // Parse tool calls from response
    const toolCalls = parseToolCalls(response);
    if (toolCalls.length === 0) {
      break; // LLM is done, no more tools to call
    }

    // Execute tools
    for (const toolCall of toolCalls) {
      yield { 
        type: 'step', 
        step: {
          id: uuidv4(),
          toolName: toolCall.name,
          input: toolCall.input,
        }
      };

      const result = await toolRegistry.execute(toolCall.name, toolCall.input);

      yield {
        type: 'step_result',
        stepId: toolCall.id,
        result: result.success ? result.content : result.error,
        error: !result.success,
      };

      // Add tool result to message history
      messages.push({
        role: 'user', // Tool results go as user messages
        content: `Tool "${toolCall.name}" result:\n${result.content || result.error}`,
      });
    }
  }
}

function parseToolCalls(response: string): Array<{
  id: string;
  name: string;
  input: Record<string, unknown>;
}> {
  // Look for patterns like:
  // <tool_use name="file_read" id="123">{"path": "file.ts"}</tool_use>
  
  const toolPattern = /<tool_use name="([^"]+)" id="([^"]+)">(.+?)<\/tool_use>/g;
  const calls = [];
  let match;

  while ((match = toolPattern.exec(response)) !== null) {
    calls.push({
      name: match[1],
      id: match[2],
      input: JSON.parse(match[3]),
    });
  }

  return calls;
}
```

---

## Section 5: Chat Component Architecture

### Continue's Structure
```
Chat.tsx
├── MessageList
│   ├── Message (User)
│   ├── Message (Assistant)
│   │   └── StepContainer[]
│   │       ├── ToolCall (showing what's being executed)
│   │       └── ToolResult (showing what tool returned)
└── InputBox
```

### For ChaosCode

**Create:** `src/renderer/src/components/LLMPanel/ChatUI.tsx`

```typescript
import React, { useRef, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';

export function ChatUI() {
  const dispatch = useDispatch();
  const messages = useSelector((state: any) => state.chat.messages);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const handleSendMessage = (text: string) => {
    dispatch(addMessage({
      id: uuidv4(),
      role: 'user',
      content: text,
    }));

    dispatch(streamMessage(text)); // Async thunk
  };

  return (
    <div className="flex flex-col h-full">
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg: any) => (
          <div key={msg.id} className={`flex ${
            msg.role === 'user' ? 'justify-end' : 'justify-start'
          }`}>
            <div className={`max-w-xs lg:max-w-md xl:max-w-lg px-4 py-2 rounded-lg ${
              msg.role === 'user'
                ? 'bg-blue-500 text-white'
                : 'bg-gray-200 text-gray-900'
            }`}>
              <div className="whitespace-pre-wrap break-words">
                {msg.content}
              </div>

              {/* Render tool steps */}
              {msg.steps && msg.steps.map((step: any) => (
                <div key={step.id} className="mt-2 text-sm border-l-2 border-gray-400 pl-2">
                  <div className="font-semibold">{step.toolName}</div>
                  {step.result && (
                    <div className="text-xs text-gray-700 mt-1">
                      {step.result}
                    </div>
                  )}
                </div>
              ))}

              {msg.streaming && (
                <div className="mt-1 text-xs opacity-75">▌</div>
              )}
            </div>
          </div>
        ))}
      </div>

      <InputBox onSend={handleSendMessage} />
    </div>
  );
}

function InputBox({ onSend }: { onSend: (text: string) => void }) {
  const [input, setInput] = React.useState('');

  const handleSubmit = () => {
    if (input.trim()) {
      onSend(input);
      setInput('');
    }
  };

  return (
    <div className="border-t p-4">
      <div className="flex gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSubmit()}
          placeholder="Ask the AI assistant..."
          className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button
          onClick={handleSubmit}
          className="px-6 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600"
        >
          Send
        </button>
      </div>
    </div>
  );
}
```

---

## Section 6: Security Validation

### Your Current Approach (Good!)
You already have `agenticSecurity.ts`. Enhance it with:

```typescript
// Add to your validation:

1. // HTML/Markdown sanitization
   import DOMPurify from 'dompurify';
   const sanitized = DOMPurify.sanitize(htmlContent);

2. // File path validation
   function isValidFilePath(path: string): boolean {
     const resolved = path.resolve(path);
     const projectRoot = process.cwd();
     return resolved.startsWith(projectRoot);
   }

3. // Token counting
   function estimateTokens(text: string): number {
     // Approximate: 1 token ≈ 4 characters
     return Math.ceil(text.length / 4);
   }

4. // Tool input validation
   function validateToolInput(tool: Tool, input: unknown): boolean {
     // Use ajv or similar for schema validation
     return ajv.validate(tool.parameters, input);
   }
```

---

## Section 7: Multi-Provider LLM Support

### For ChaosCode

**Create:** `src/services/llmProvider.ts`

```typescript
interface LLMProvider {
  stream(
    messages: ChatMessage[],
    tools?: ToolDefinition[]
  ): AsyncIterator<string>;
  
  countTokens(text: string): number;
}

class OpenAIProvider implements LLMProvider {
  async *stream(messages, tools) {
    const response = await openai.chat.completions.create({
      model: 'gpt-4',
      messages,
      tools: tools?.map(t => ({ type: 'function', function: t })),
      stream: true,
    });

    for await (const chunk of response) {
      if (chunk.choices[0]?.delta?.content) {
        yield chunk.choices[0].delta.content;
      }
    }
  }

  countTokens(text: string): number {
    // Use tiktoken library
    return encode(text).length;
  }
}

class ClaudeProvider implements LLMProvider {
  async *stream(messages, tools) {
    const stream = client.messages.stream({
      model: 'claude-3-5-sonnet',
      max_tokens: 1024,
      system: 'You are a helpful coding assistant.',
      messages,
      tools: tools?.map(t => ({ name: t.name, input_schema: t.parameters })),
    });

    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        yield event.delta.text || '';
      }
    }
  }

  countTokens(text: string): number {
    // Claude token counting
    return Math.ceil(text.length / 3.8); // Approximate
  }
}
```

---

## Section 8: Integration Checklist

### Phase 1: Foundation (Weeks 1-2)
- [ ] Copy Redux chat slice structure
- [ ] Implement streaming from API
- [ ] Create basic MessageList component
- [ ] Add Redux thunk for async dispatch

### Phase 2: Tools (Weeks 3-4)
- [ ] Create ToolRegistry class
- [ ] Register your tools (file_read, code_edit, etc.)
- [ ] Implement tool execution loop
- [ ] Add StepContainer component

### Phase 3: Multi-LLM (Weeks 5-6)
- [ ] Abstract LLM interface
- [ ] Add OpenAI provider
- [ ] Add Claude provider
- [ ] Implement fallback logic

### Phase 4: Polish (Weeks 7-8)
- [ ] Add markdown rendering
- [ ] Syntax highlighting for code
- [ ] Auto-scroll behavior
- [ ] Loading states and animations
- [ ] Keyboard shortcuts
- [ ] Error handling UI

---

## Section 9: Testing Strategy

```typescript
// Test streaming
test('streams message tokens', async () => {
  const chunks = ['Hello', ' ', 'world'];
  const result = [];
  for await (const chunk of streamMessage('test')) {
    result.push(chunk);
  }
  expect(result.join('')).toBe('Hello world');
});

// Test tool execution
test('executes registered tool', async () => {
  const result = await toolRegistry.execute('file_read', { path: 'test.ts' });
  expect(result.success).toBe(true);
});

// Test agent loop
test('agent loop completes', async () => {
  const messages = [];
  for await (const msg of executeAgentLoop('explain this code')) {
    messages.push(msg);
  }
  expect(messages.length).toBeGreaterThan(0);
});
```

---

## Key Takeaways

1. **Stream by default** - Not optional
2. **Redux for state** - Predictable and debuggable
3. **Tool registry** - Extensible without code changes
4. **Validate inputs** - LLM outputs are untrusted
5. **Multi-provider** - Avoid vendor lock-in
6. **Incremental UI** - Better UX
7. **Clear error states** - User sees problems
8. **Test edge cases** - Streaming interrupts, tool failures, etc.

---

**Created:** April 5, 2026  
**References:** Continue repository patterns  
**Next Steps:** Follow Phase 1-4 checklist above

