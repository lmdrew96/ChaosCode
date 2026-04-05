import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import {
  buildAgenticReviewUserMessage,
  haikuAgenticSystemPrompt,
  haikuSystemPrompt,
  sonnetAgenticReviewSystemPrompt,
  sonnetSystemPrompt,
} from './prompts'

dotenv.config()

const HAIKU_MODEL = 'claude-haiku-4-5'
const SONNET_MODEL = 'claude-sonnet-4-6'

function createAnthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')
  return new Anthropic({ apiKey })
}

function toAnthropicMessages(messages: Array<{ role: string; content: string }>) {
  return messages.map((m) => ({
    role: m.role as 'user' | 'assistant',
    content: m.content,
  }))
}

function createWindow(): BrowserWindow {
   const win = new BrowserWindow({
     width: 1400,
     height: 900,
     minWidth: 900,
     minHeight: 600,
     backgroundColor: '#0f0f0f',
     titleBarStyle: 'hiddenInset',
     trafficLightPosition: { x: 16, y: 16 },
     webPreferences: {
       preload: join(__dirname, '../preload/index.js'),
       contextIsolation: true,
       nodeIntegration: false,
       sandbox: false,
       webSecurity: true
     }
   })

   if (process.env.NODE_ENV === 'development') {
     win.loadURL('http://localhost:5173')
     win.webContents.openDevTools({ mode: 'detach' })
   } else {
     win.loadFile(join(__dirname, '../renderer/index.html'))
   }

    // Set CSP headers for web resources
    win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [
            process.env.NODE_ENV === 'development'
              ? "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http://localhost:5173; connect-src 'self' http://localhost:5173; worker-src 'self' blob: http://localhost:5173; font-src 'self' data:;"
              : "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; font-src 'self' data:;"
          ]
        }
      })
    })

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  return win
}

// --- File System IPC ---

ipcMain.handle('fs:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

// ─── Cancellation (Continue-style AbortController, adapted for IPC) ───────────
// Each LLM call accepts a requestId. The renderer sends 'llm:cancel' to abort.
const cancelledRequests = new Set<string>()

ipcMain.handle('llm:cancel', (_event, requestId: string) => {
  cancelledRequests.add(requestId)
})

function isCancelled(requestId: string): boolean {
  return cancelledRequests.has(requestId)
}

function clearCancel(requestId: string): void {
  cancelledRequests.delete(requestId)
}

// ─── File system ──────────────────────────────────────────────────────────────

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
})

ipcMain.handle('llm:haiku:agentic', async (event, userTask: string, requestId: string) => {
  const anthropic = createAnthropicClient()
  const stream = anthropic.messages.stream({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: haikuAgenticSystemPrompt,
    messages: [{ role: 'user', content: userTask }]
  })

  let fullText = ''
  const tokenChannel = `llm:haiku:agentic:token:${requestId}`
  const doneChannel = `llm:haiku:agentic:done:${requestId}`
  for await (const chunk of stream) {
    if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
    if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue
    const token = chunk.delta.text
    fullText += token
    event.sender.send(tokenChannel, token)
  }
  event.sender.send(doneChannel)
  return fullText
})

ipcMain.handle('llm:sonnet:agentic-review', async (
  _event,
  { filePath, content, userTask }: { filePath: string; content: string; userTask: string }
) => {
  const anthropic = createAnthropicClient()
  const response = await anthropic.messages.create({
    model: SONNET_MODEL,
    max_tokens: 4096,
    system: sonnetAgenticReviewSystemPrompt,
    messages: [{
      role: 'user',
      content: buildAgenticReviewUserMessage({ filePath, content, userTask }),
    }]
  })

  return response.content[0].type === 'text' ? response.content[0].text : ''
})

interface FileNode {
  name: string
  path: string
  type: 'file' | 'directory'
  children?: FileNode[]
}

function buildFileTree(dirPath: string, depth = 0): FileNode[] {
  if (depth > 4) return []
  const entries = readdirSync(dirPath)
  const nodes: FileNode[] = []

  for (const entry of entries) {
    if (entry.startsWith('.') || entry === 'node_modules' || entry === 'out') continue
    const fullPath = join(dirPath, entry)
    const stat = statSync(fullPath)
    if (stat.isDirectory()) {
      nodes.push({
        name: entry,
        path: fullPath,
        type: 'directory',
        children: buildFileTree(fullPath, depth + 1)
      })
    } else {
      nodes.push({ name: entry, path: fullPath, type: 'file' })
    }
  }

  return nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

ipcMain.handle('fs:listDir', async (_event, dirPath: string) => {
  return buildFileTree(dirPath)
})

// --- LLM IPC ---

ipcMain.handle('llm:haiku', async (
  event,
  messages: Array<{ role: string; content: string }>,
  requestId: string
) => {
  const anthropic = createAnthropicClient()
  const stream = anthropic.messages.stream({
    model: HAIKU_MODEL,
    max_tokens: 4096,
    system: haikuSystemPrompt,
    messages: toAnthropicMessages(messages)
  })

  let fullText = ''
  for await (const chunk of stream) {
    if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
    if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue
    const token = chunk.delta.text
    fullText += token
    event.sender.send('llm:haiku:token', token)
  }

  event.sender.send('llm:haiku:done')
  return fullText
})

ipcMain.handle('llm:sonnet', async (
  event,
  messages: Array<{ role: string; content: string }>,
  requestId: string
) => {
  const anthropic = createAnthropicClient()

  const stream = anthropic.messages.stream({
    model: SONNET_MODEL,
    max_tokens: 8096,
    system: sonnetSystemPrompt,
    messages: toAnthropicMessages(messages)
  })

  let fullText = ''
  for await (const chunk of stream) {
    if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
    if (
      chunk.type === 'content_block_delta' &&
      chunk.delta.type === 'text_delta'
    ) {
      const token = chunk.delta.text
      fullText += token
      event.sender.send('llm:sonnet:token', token)
    }
  }

  event.sender.send('llm:sonnet:done')
  return fullText
})

// --- App lifecycle ---

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
