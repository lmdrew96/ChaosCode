# Quick Reference: Continue Patterns for ChaosCode

## 🎯 Top 5 Patterns to Adopt

### 1. **Streaming as Foundation**
Stream tokens in real-time instead of waiting for full response.
**File:** `core/llm/streamChat.ts`

### 2. **Redux Thunks for Async**
Use Redux thunks for streaming updates with incremental UI re-renders.
**File:** `gui/src/redux/thunks/streamResponse.ts`

### 3. **Tool Registry Pattern**
Tools are registered plugins, not hardcoded. Easy to add new tools.
**File:** `extensions/cli/src/subagent/executor.ts`

### 4. **Component Structure**
Chat → MessageList → Message[] → (User/Assistant + StepContainer for tools)
**File:** `gui/src/pages/gui/Chat.tsx` (534 lines, use as template)

### 5. **Security-First Design**
Validate all LLM outputs, check token limits, sanitize code.
**File:** Your `agenticSecurity.ts` (good start, reference for depth)

---

## 📁 Must-Study Files

| Feature | File | Lines |
|---------|------|-------|
| Streaming | `core/llm/streamChat.ts` | 157 |
| Chat UI | `gui/src/pages/gui/Chat.tsx` | 534 |
| Redux Thunks | `gui/src/redux/thunks/streamResponse.ts` | Complex |
| Tool Execution | `extensions/cli/src/subagent/executor.ts` | 168 |
| Tool Parsing | `extensions/cli/src/stream/handleToolCalls.ts` | - |
| Error Display | `gui/src/pages/gui/StreamError.tsx` | - |
| Auto-scroll | `gui/src/pages/gui/useAutoScroll.ts` | - |

---

## 🔧 Implementation Priority

**Week 1-2:** Streaming UI + Redux  
**Week 3-4:** Tool execution loop  
**Week 5-6:** Multi-provider LLM support  
**Week 7-8:** Polish (markdown, syntax highlighting, animations)  

---

## 💾 Key Architectural Patterns

**State Management:** Redux with thunks  
**Message Format:** ContentBlock pattern (text/tool_use/tool_result)  
**LLM Interface:** Async iterators for streaming  
**Tool System:** Registry-based with schema validation  
**Error Handling:** First-class UI states  

---

## ⚠️ Critical Patterns

1. Stream tokens in real-time
2. Validate ALL LLM outputs
3. Track token usage/costs
4. Use tool registry (not hardcoded)
5. Graceful error recovery
6. Incremental UI updates
7. Easy interruption of requests
8. Multi-provider support from start

---

Full investigation: See `CONTINUE_INVESTIGATION.md`

