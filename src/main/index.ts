import { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, Menu, clipboard } from 'electron'
import { join, dirname, resolve, relative, isAbsolute } from 'path'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import { extname } from 'path'
import { spawn } from 'child_process'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import * as pty from 'node-pty'
import {
  buildAgenticReviewUserMessage,
  buildPlanReviewUserMessage,
  haikuAgenticSystemPrompt,
  haikuPlanningSystemPrompt,
  haikuSystemPrompt,
  sonnetAgenticReviewSystemPrompt,
  sonnetPlanReviewSystemPrompt,
  sonnetSystemPrompt,
} from './prompts'
import { providerRegistry } from './providers/registry'

dotenv.config()

const HAIKU_MODEL = 'claude-haiku-4-5'
const SONNET_MODEL = 'claude-sonnet-4-6'

/** Validate a caller-supplied model ID, falling back to the default if invalid. */
function resolveModel(requested: string | undefined, fallback: string): string {
  if (!requested) return fallback
  return providerRegistry.isValid(requested) ? requested : fallback
}

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

interface Attachment {
  name: string
  mediaType: string
  data: string
  size: number
}

const IMAGE_MEDIA_TYPES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp'])

function getAttachmentMediaType(filePath: string): string {
  const ext = extname(filePath).slice(1).toLowerCase()
  const map: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp',
  }
  return map[ext] ?? 'text/plain'
}

function buildMessagesWithAttachments(
  messages: Array<{ role: string; content: string }>,
  attachments: Attachment[]
): Anthropic.MessageParam[] {
  const base = toAnthropicMessages(messages)
  if (!attachments.length) return base

  const lastIdx = base.length - 1
  if (lastIdx < 0 || base[lastIdx].role !== 'user') return base

  const textContent = base[lastIdx].content as string
  const blocks: Anthropic.ContentBlockParam[] = []

  for (const att of attachments) {
    if (IMAGE_MEDIA_TYPES.has(att.mediaType)) {
      blocks.push({
        type: 'image',
        source: {
          type: 'base64',
          media_type: att.mediaType as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
          data: att.data,
        },
      })
    } else {
      blocks.push({ type: 'text', text: `[Attached file: ${att.name}]\n${att.data}` })
    }
  }

  if (textContent) blocks.push({ type: 'text', text: textContent })

  return [...base.slice(0, lastIdx), { role: 'user', content: blocks }]
}

// ─── Read-only file tool (chat mode) ─────────────────────────────────────────

const READ_FILE_TOOL: Anthropic.Tool = {
  name: 'read_file',
  description:
    'Read the full contents of any project file. Use this to inspect a file before answering questions or suggesting changes. Do not call this for files already provided in <context_bundle>.',
  input_schema: {
    type: 'object' as const,
    properties: {
      path: {
        type: 'string',
        description: 'File path relative to the project root (e.g. "src/utils/helpers.ts")',
      },
    },
    required: ['path'],
  },
}

/**
 * Resolve a model-supplied path to an absolute path and verify it stays
 * within the project root (prevents path traversal).
 */
function resolveSafePath(rootPath: string, filePath: string): string {
  const abs = isAbsolute(filePath) ? filePath : resolve(rootPath, filePath)
  const rel = relative(rootPath, abs)
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${filePath}" is outside the project root`)
  }
  return abs
}

/**
 * Execute a single read_file tool call and return a ToolResultBlockParam.
 */
function executeReadFile(
  rootPath: string | null | undefined,
  toolUse: Anthropic.ToolUseBlock
): Anthropic.ToolResultBlockParam {
  try {
    if (!rootPath) throw new Error('No project folder is open')
    const input = toolUse.input as { path?: string }
    if (!input.path) throw new Error('Missing required "path" argument')
    const safePath = resolveSafePath(rootPath, input.path)
    const content = readFileSync(safePath, 'utf-8')
    return { type: 'tool_result', tool_use_id: toolUse.id, content }
  } catch (err) {
    return {
      type: 'tool_result',
      tool_use_id: toolUse.id,
      content: err instanceof Error ? err.message : String(err),
      is_error: true,
    }
  }
}

function createWindow(): BrowserWindow {
   const backgroundColor = nativeTheme.shouldUseDarkColors ? '#0f0f0f' : '#f8fafc'

   const win = new BrowserWindow({
     width: 1400,
     height: 900,
     minWidth: 900,
     minHeight: 600,
      backgroundColor,
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

  // Right-click context menu: Copy when text is selected, Paste in inputs
  win.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = []
    if (params.selectionText) {
      items.push({
        label: 'Copy',
        accelerator: 'CmdOrCtrl+C',
        click: () => clipboard.writeText(params.selectionText),
      })
    }
    if (params.isEditable) {
      if (params.selectionText) {
        items.push({
          label: 'Cut',
          accelerator: 'CmdOrCtrl+X',
          role: 'cut',
        })
      }
      items.push({ label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' })
    }
    if (items.length) Menu.buildFromTemplate(items).popup()
  })

  return win
}

// --- File System IPC ---

ipcMain.handle('fs:openFolder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
})

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024 // 5 MB

ipcMain.handle('dialog:pickFile', async (): Promise<Attachment[] | null> => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp'] },
      { name: 'Text / Code', extensions: ['txt', 'md', 'ts', 'tsx', 'js', 'jsx', 'py', 'json', 'css', 'html', 'yaml', 'toml', 'sh'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  })
  if (result.canceled || result.filePaths.length === 0) return null

  return result.filePaths.map((filePath) => {
    const stat = statSync(filePath)
    if (stat.size > MAX_ATTACHMENT_BYTES) {
      throw new Error(`${filePath.split('/').pop()} is too large (${(stat.size / 1024 / 1024).toFixed(1)} MB — limit is 5 MB)`)
    }
    const name = filePath.split('/').pop() ?? filePath
    const mediaType = getAttachmentMediaType(filePath)
    if (IMAGE_MEDIA_TYPES.has(mediaType)) {
      return { name, mediaType, data: readFileSync(filePath).toString('base64'), size: stat.size }
    }
    return { name, mediaType, data: readFileSync(filePath, 'utf-8'), size: stat.size }
  })
})

// ─── Provider/model discovery ─────────────────────────────────────────────────

ipcMain.handle('llm:models', () => providerRegistry.allModels())

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

const MAX_READ_FILE_BYTES = 2 * 1024 * 1024 // 2 MB

ipcMain.handle('fs:readFile', async (_event, filePath: string) => {
  const stat = statSync(filePath)
  if (stat.size > MAX_READ_FILE_BYTES) {
    throw new Error(`File too large to open (${(stat.size / 1024 / 1024).toFixed(1)} MB — limit is 2 MB)`)
  }
  return readFileSync(filePath, 'utf-8')
})

ipcMain.handle('fs:writeFile', async (_event, filePath: string, content: string) => {
  mkdirSync(dirname(filePath), { recursive: true })
  writeFileSync(filePath, content, 'utf-8')
})

const STREAM_TIMEOUT_MS = 120_000
const PLAN_STREAM_TIMEOUT_MS = 60_000

ipcMain.handle('llm:haiku:plan', async (event, userTask: string, requestId: string, model?: string) => {
  const anthropic = createAnthropicClient()
  const stream = anthropic.messages.stream({
    model: resolveModel(model, HAIKU_MODEL),
    max_tokens: 2048,
    system: haikuPlanningSystemPrompt,
    messages: [{ role: 'user', content: userTask }]
  })

  const timeout = setTimeout(() => stream.abort(), PLAN_STREAM_TIMEOUT_MS)
  let fullText = ''
  const tokenChannel = `llm:haiku:plan:token:${requestId}`
  const doneChannel = `llm:haiku:plan:done:${requestId}`
  try {
    for await (const chunk of stream) {
      if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
      if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue
      const token = chunk.delta.text
      fullText += token
      if (!event.sender.isDestroyed()) event.sender.send(tokenChannel, token)
    }
  } finally {
    clearTimeout(timeout)
  }
  if (!event.sender.isDestroyed()) event.sender.send(doneChannel)
  return fullText
})

ipcMain.handle('llm:sonnet:plan-review', async (
  _event,
  { userTask, planText, model }: { userTask: string; planText: string; model?: string }
) => {
  const anthropic = createAnthropicClient()
  const response = await anthropic.messages.create({
    model: resolveModel(model, SONNET_MODEL),
    max_tokens: 2048,
    system: sonnetPlanReviewSystemPrompt,
    messages: [{
      role: 'user',
      content: buildPlanReviewUserMessage({ userTask, planText }),
    }]
  })
  return response.content[0].type === 'text' ? response.content[0].text : ''
})

ipcMain.handle('llm:haiku:agentic', async (event, userTask: string, requestId: string, model?: string) => {
  const anthropic = createAnthropicClient()
  const stream = anthropic.messages.stream({
    model: resolveModel(model, HAIKU_MODEL),
    max_tokens: 4096,
    system: haikuAgenticSystemPrompt,
    messages: [{ role: 'user', content: userTask }]
  })

  const timeout = setTimeout(() => stream.abort(), STREAM_TIMEOUT_MS)
  let fullText = ''
  const tokenChannel = `llm:haiku:agentic:token:${requestId}`
  const doneChannel = `llm:haiku:agentic:done:${requestId}`
  try {
    for await (const chunk of stream) {
      if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
      if (chunk.type !== 'content_block_delta' || chunk.delta.type !== 'text_delta') continue
      const token = chunk.delta.text
      fullText += token
      if (!event.sender.isDestroyed()) event.sender.send(tokenChannel, token)
    }
  } finally {
    clearTimeout(timeout)
  }
  if (!event.sender.isDestroyed()) event.sender.send(doneChannel)
  return fullText
})

ipcMain.handle('llm:sonnet:agentic-review', async (
  _event,
  { filePath, content, userTask, model }: { filePath: string; content: string; userTask: string; model?: string }
) => {
  const anthropic = createAnthropicClient()
  const response = await anthropic.messages.create({
    model: resolveModel(model, SONNET_MODEL),
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
  requestId: string,
  rootPath?: string | null,
  model?: string,
  attachments?: Attachment[]
) => {
  const anthropic = createAnthropicClient()
  const tools = rootPath ? [READ_FILE_TOOL] : undefined
  let currentMessages: Anthropic.MessageParam[] = buildMessagesWithAttachments(messages, attachments ?? [])
  let fullText = ''

  // Tool loop: keep sending until the model stops requesting tool calls
  for (;;) {
    const stream = anthropic.messages.stream({
      model: resolveModel(model, HAIKU_MODEL),
      max_tokens: 2048,
      system: haikuSystemPrompt,
      messages: currentMessages,
      ...(tools ? { tools } : {}),
    })

    const timeout = setTimeout(() => stream.abort(), STREAM_TIMEOUT_MS)
    try {
      for await (const chunk of stream) {
        if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const token = chunk.delta.text
          fullText += token
          if (!event.sender.isDestroyed()) event.sender.send('llm:haiku:token', token)
        }
      }
    } finally {
      clearTimeout(timeout)
    }

    if (isCancelled(requestId)) break

    const finalMsg = await stream.finalMessage()
    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (toolUses.length === 0 || finalMsg.stop_reason !== 'tool_use') break

    // Execute tool calls and loop back
    const toolResults = toolUses.map((t) => executeReadFile(rootPath, t))
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMsg.content },
      { role: 'user', content: toolResults },
    ]
  }

  if (!event.sender.isDestroyed()) event.sender.send('llm:haiku:done')
  return fullText
})

ipcMain.handle('llm:sonnet', async (
  event,
  messages: Array<{ role: string; content: string }>,
  requestId: string,
  rootPath?: string | null,
  model?: string,
  attachments?: Attachment[]
) => {
  const anthropic = createAnthropicClient()
  const tools = rootPath ? [READ_FILE_TOOL] : undefined
  let currentMessages: Anthropic.MessageParam[] = buildMessagesWithAttachments(messages, attachments ?? [])
  let fullText = ''

  for (;;) {
    const stream = anthropic.messages.stream({
      model: resolveModel(model, SONNET_MODEL),
      max_tokens: 4096,
      system: sonnetSystemPrompt,
      messages: currentMessages,
      ...(tools ? { tools } : {}),
    })

    const timeout = setTimeout(() => stream.abort(), STREAM_TIMEOUT_MS)
    try {
      for await (const chunk of stream) {
        if (isCancelled(requestId)) { clearCancel(requestId); stream.abort(); break }
        if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
          const token = chunk.delta.text
          fullText += token
          if (!event.sender.isDestroyed()) event.sender.send('llm:sonnet:token', token)
        }
      }
    } finally {
      clearTimeout(timeout)
    }

    if (isCancelled(requestId)) break

    const finalMsg = await stream.finalMessage()
    const toolUses = finalMsg.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use'
    )

    if (toolUses.length === 0 || finalMsg.stop_reason !== 'tool_use') break

    const toolResults = toolUses.map((t) => executeReadFile(rootPath, t))
    currentMessages = [
      ...currentMessages,
      { role: 'assistant', content: finalMsg.content },
      { role: 'user', content: toolResults },
    ]
  }

  if (!event.sender.isDestroyed()) event.sender.send('llm:sonnet:done')
  return fullText
})

// --- Terminal IPC ---

const terminals = new Map<string, ReturnType<typeof pty.spawn>>()

ipcMain.handle('terminal:create', async (event, cols: number, rows: number, cwd?: string) => {
  const id = Math.random().toString(36).slice(2)
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || '/bin/bash')

  const term = pty.spawn(shell, [], {
    name: 'xterm-color',
    cols: cols || 80,
    rows: rows || 24,
    cwd: cwd || process.env.HOME,
    env: process.env as Record<string, string>,
  })

  term.onData((data) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`terminal:data:${id}`, data)
    }
  })

  term.onExit(({ exitCode }) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(`terminal:exit:${id}`, exitCode)
    }
    terminals.delete(id)
  })

  terminals.set(id, term)
  return id
})

ipcMain.handle('terminal:write', async (_event, id: string, data: string) => {
  terminals.get(id)?.write(data)
})

ipcMain.handle('terminal:resize', async (_event, id: string, cols: number, rows: number) => {
  terminals.get(id)?.resize(cols, rows)
})

ipcMain.handle('terminal:kill', async (_event, id: string) => {
  terminals.get(id)?.kill()
  terminals.delete(id)
})

ipcMain.handle('terminal:run-command', async (_event, command: string, cwd?: string, rootPath?: string) => {
  return new Promise<{ stdout: string; stderr: string; exitCode: number }>((resolve) => {
    let resolvedCwd: string
    if (rootPath) {
      try {
        resolvedCwd = resolveSafePath(rootPath, cwd || '')
      } catch (err) {
        return resolve({ stdout: '', stderr: err instanceof Error ? err.message : String(err), exitCode: 1 })
      }
    } else {
      resolvedCwd = cwd || process.env.HOME || '/'
    }

    const shell = process.platform === 'win32' ? 'cmd' : (process.env.SHELL || '/bin/sh')
    const shellFlag = process.platform === 'win32' ? '/c' : '-c'

    const proc = spawn(shell, [shellFlag, command], {
      cwd: resolvedCwd,
      env: process.env,
    })

    let stdout = ''
    let stderr = ''

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (exitCode) => {
      resolve({ stdout, stderr, exitCode: exitCode ?? 0 })
    })

    proc.on('error', (err) => {
      resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
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
