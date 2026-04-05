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
  sendToHaiku: (messages: { role: string; content: string }[], requestId: string) => Promise<string>
  sendToSonnet: (messages: { role: string; content: string }[], requestId: string) => Promise<string>

  // Agentic LLMs
  sendToHaikuAgentic: (userTask: string, requestId: string) => Promise<string>
  sonnetAgenticReview: (args: {
    filePath: string
    content: string
    userTask: string
  }) => Promise<string>

  // Streaming listeners
  onHaikuToken: (cb: (token: string) => void) => void
  onHaikuDone: (cb: () => void) => void
  onHaikuAgenticToken: (requestId: string, cb: (token: string) => void) => () => void
  onHaikuAgenticDone: (requestId: string, cb: () => void) => () => void
  onSonnetToken: (cb: (token: string) => void) => void
  onSonnetDone: (cb: () => void) => void
  removeAllListeners: (channel: string) => void
}

const api: Api = {
  openFolder: () => ipcRenderer.invoke('fs:openFolder'),
  readFile: (path) => ipcRenderer.invoke('fs:readFile', path),
  writeFile: (path, content) => ipcRenderer.invoke('fs:writeFile', path, content),
  listDir: (path) => ipcRenderer.invoke('fs:listDir', path),

  cancelRequest: (requestId) => ipcRenderer.invoke('llm:cancel', requestId),

  sendToHaiku: (messages, requestId) => ipcRenderer.invoke('llm:haiku', messages, requestId),
  sendToSonnet: (messages, requestId) => ipcRenderer.invoke('llm:sonnet', messages, requestId),

  sendToHaikuAgentic: (userTask, requestId) => ipcRenderer.invoke('llm:haiku:agentic', userTask, requestId),
  sonnetAgenticReview: (args) => ipcRenderer.invoke('llm:sonnet:agentic-review', args),

  onHaikuToken: (cb) => { ipcRenderer.on('llm:haiku:token', (_e, token) => cb(token)) },
  onHaikuDone: (cb) => { ipcRenderer.on('llm:haiku:done', () => cb()) },
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
  onSonnetToken: (cb) => { ipcRenderer.on('llm:sonnet:token', (_e, token) => cb(token)) },
  onSonnetDone: (cb) => { ipcRenderer.on('llm:sonnet:done', () => cb()) },
  removeAllListeners: (channel) => { ipcRenderer.removeAllListeners(channel) }
}

contextBridge.exposeInMainWorld('api', api)
