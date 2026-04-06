import { contextBridge, ipcRenderer } from 'electron'

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

export interface Attachment {
  name: string
  mediaType: string
  data: string
  size: number
}

export type Api = {
  // File system
  openFolder: () => Promise<string | null>
  readFile: (path: string) => Promise<string>
  writeFile: (path: string, content: string) => Promise<void>
  listDir: (path: string) => Promise<FileNode[]>

  // Cancellation
  cancelRequest: (requestId: string) => Promise<void>

  // Provider/model discovery
  getModels: () => Promise<Array<{
    id: string; label: string; providerId: string; providerName: string
    contextWindow: number; costInputPer1M: number; costOutputPer1M: number
  }>>

  // File attachments
  pickFile: () => Promise<Attachment[] | null>

  // Chat LLMs
  sendToHaiku: (messages: { role: string; content: string }[], requestId: string, rootPath?: string | null, model?: string, attachments?: Attachment[]) => Promise<string>
  sendToSonnet: (messages: { role: string; content: string }[], requestId: string, rootPath?: string | null, model?: string, attachments?: Attachment[]) => Promise<string>

  // Agentic LLMs
  sendToHaikuPlan: (userTask: string, requestId: string, model?: string, toolsDocs?: string, imageAttachments?: Attachment[]) => Promise<string>
  sonnetPlanReview: (args: { userTask: string; planText: string; model?: string; toolsDocs?: string }) => Promise<string>
  sendToHaikuAgentic: (userTask: string, requestId: string, model?: string, toolsDocs?: string) => Promise<string>
  sonnetAgenticReview: (args: {
    filePath: string
    content: string
    userTask: string
    model?: string
  }) => Promise<string>

  // Streaming listeners
  onHaikuToken: (cb: (token: string) => void) => () => void
  onHaikuDone: (cb: () => void) => () => void
  onHaikuPlanToken: (requestId: string, cb: (token: string) => void) => () => void
  onHaikuPlanDone: (requestId: string, cb: () => void) => () => void
  onHaikuAgenticToken: (requestId: string, cb: (token: string) => void) => () => void
  onHaikuAgenticDone: (requestId: string, cb: () => void) => () => void
  onSonnetToken: (cb: (token: string) => void) => () => void
  onSonnetDone: (cb: () => void) => () => void
  removeAllListeners: (channel: string) => void

  // Terminal — interactive PTY
  terminalCreate: (cols: number, rows: number, cwd?: string) => Promise<string>
  terminalWrite: (id: string, data: string) => Promise<void>
  terminalResize: (id: string, cols: number, rows: number) => Promise<void>
  terminalKill: (id: string) => Promise<void>
  onTerminalData: (id: string, cb: (data: string) => void) => () => void
  onTerminalExit: (id: string, cb: (exitCode: number) => void) => () => void

  // Terminal — run command (for agents)
  runCommand: (command: string, cwd?: string, rootPath?: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>

  // Tooltip — explain a symbol at hover
  getTooltip: (word: string, context: string, language: string) => Promise<string>
}

const api: Api = {
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),

  cancelRequest: (requestId) => ipcRenderer.invoke('llm:cancel', requestId),

  getModels: () => ipcRenderer.invoke('llm:models'),

  pickFile: () => ipcRenderer.invoke('dialog:pickFile'),

  sendToHaiku: (messages, requestId, rootPath, model, attachments) => ipcRenderer.invoke('llm:haiku', messages, requestId, rootPath, model, attachments),
  sendToSonnet: (messages, requestId, rootPath, model, attachments) => ipcRenderer.invoke('llm:sonnet', messages, requestId, rootPath, model, attachments),

  sendToHaikuPlan: (userTask, requestId, model, toolsDocs, imageAttachments) => ipcRenderer.invoke('llm:haiku:plan', userTask, requestId, model, toolsDocs, imageAttachments),
  sonnetPlanReview: (args) => ipcRenderer.invoke('llm:sonnet:plan-review', args),
  sendToHaikuAgentic: (userTask, requestId, model, toolsDocs) => ipcRenderer.invoke('llm:haiku:agentic', userTask, requestId, model, toolsDocs),
  sonnetAgenticReview: (args) => ipcRenderer.invoke('llm:sonnet:agentic-review', args),

  onHaikuToken: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on('llm:haiku:token', listener)
    return () => ipcRenderer.removeListener('llm:haiku:token', listener)
  },
  onHaikuDone: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('llm:haiku:done', listener)
    return () => ipcRenderer.removeListener('llm:haiku:done', listener)
  },
  onHaikuPlanToken: (requestId, cb) => {
    const channel = `llm:haiku:plan:token:${requestId}`
    const listener = (_e: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onHaikuPlanDone: (requestId, cb) => {
    const channel = `llm:haiku:plan:done:${requestId}`
    const listener = () => cb()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onHaikuAgenticToken: (requestId, cb) => {
    const channel = `llm:haiku:agentic:token:${requestId}`
    const listener = (_e: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onHaikuAgenticDone: (requestId, cb) => {
    const channel = `llm:haiku:agentic:done:${requestId}`
    const listener = () => cb()
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onSonnetToken: (cb) => {
    const listener = (_e: Electron.IpcRendererEvent, token: string) => cb(token)
    ipcRenderer.on('llm:sonnet:token', listener)
    return () => ipcRenderer.removeListener('llm:sonnet:token', listener)
  },
  onSonnetDone: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('llm:sonnet:done', listener)
    return () => ipcRenderer.removeListener('llm:sonnet:done', listener)
  },
  removeAllListeners: (channel) => { ipcRenderer.removeAllListeners(channel) },

  terminalCreate: (cols, rows, cwd) => ipcRenderer.invoke('terminal:create', cols, rows, cwd),
  terminalWrite: (id, data) => ipcRenderer.invoke('terminal:write', id, data),
  terminalResize: (id, cols, rows) => ipcRenderer.invoke('terminal:resize', id, cols, rows),
  terminalKill: (id) => ipcRenderer.invoke('terminal:kill', id),
  onTerminalData: (id, cb) => {
    const channel = `terminal:data:${id}`
    const listener = (_e: Electron.IpcRendererEvent, data: string) => cb(data)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  onTerminalExit: (id, cb) => {
    const channel = `terminal:exit:${id}`
    const listener = (_e: Electron.IpcRendererEvent, exitCode: number) => cb(exitCode)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },

  runCommand: (command, cwd, rootPath) => ipcRenderer.invoke('terminal:run-command', command, cwd, rootPath),

  getTooltip: (word, context, language) => ipcRenderer.invoke('llm:tooltip', word, context, language),
}

contextBridge.exposeInMainWorld('api', api)
