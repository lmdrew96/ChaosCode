import { contextBridge, ipcRenderer } from 'electron'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export type Api = {
  // File system
  openFolder: () => Promise<string | null>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  listDir: (path: string) => Promise<FileNode[]>

  // Cancellation
  cancelRequest: (requestId: string) => Promise<void>

  // Chat LLMs
  sendToGemini: (messages: { role: string; content: string }[], requestId: string) => Promise<string>
  sendToClaude: (messages: { role: string; content: string }[], requestId: string) => Promise<string>

  // Agentic LLMs
  sendToGeminiAgentic: (userTask: string, requestId: string) => Promise<string>
  claudeAgenticReview: (args: {
    filePath: string
    content: string
    userTask: string
  }) => Promise<string>

  // Streaming listeners
  onGeminiToken: (cb: (token: string) => void) => void
  onGeminiDone: (cb: () => void) => void
  onClaudeToken: (cb: (token: string) => void) => void
  onClaudeDone: (cb: () => void) => void
  removeAllListeners: (channel: string) => void
}

const api: Api = {
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),

  cancelRequest: (requestId) => ipcRenderer.invoke('llm:cancel', requestId),

  sendToGemini: (messages, requestId) => ipcRenderer.invoke('llm:gemini', messages, requestId),
  sendToClaude: (messages, requestId) => ipcRenderer.invoke('llm:claude', messages, requestId),

  sendToGeminiAgentic: (userTask, requestId) => ipcRenderer.invoke('llm:gemini:agentic', userTask, requestId),
  claudeAgenticReview: (args) => ipcRenderer.invoke('llm:claude:agentic-review', args),

  onGeminiToken: (cb) => { ipcRenderer.on('llm:gemini:token', (_e, token) => cb(token)) },
  onGeminiDone: (cb) => { ipcRenderer.on('llm:gemini:done', () => cb()) },
  onClaudeToken: (cb) => { ipcRenderer.on('llm:claude:token', (_e, token) => cb(token)) },
  onClaudeDone: (cb) => { ipcRenderer.on('llm:claude:done', () => cb()) },
  removeAllListeners: (channel) => { ipcRenderer.removeAllListeners(channel) }
}

contextBridge.exposeInMainWorld('api', api)
