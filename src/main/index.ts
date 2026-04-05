import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import { join, dirname } from 'path'
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'fs'
import * as dotenv from 'dotenv'
import Anthropic from '@anthropic-ai/sdk'
import { GoogleGenerativeAI } from '@google/generative-ai'

dotenv.config()

const geminiSystemPrompt = `You are a collaborative coding assistant inside ChaosCode, a multi-LLM agentic IDE built by ADHDesigns. You will always be given the contents of the currently open file as context.

You respond first. Give your best, direct answer. Be concrete and actionable. Do not hedge excessively. Commit to your implementation decisions.

Another AI (Claude) will review your response after you. Write as though your work will be reviewed.`

const claudeSystemPrompt = `You are a collaborative coding assistant inside ChaosCode, a multi-LLM agentic IDE built by ADHDesigns. You will always be given the contents of the currently open file as context.

You respond after Gemini. Your job is to act as Editor-in-Chief:
- Review Gemini's response critically
- Validate what is correct
- Directly fix what is wrong or incomplete — do not just leave notes
- If you fully agree with Gemini's output, say so briefly and add any remaining value

In agentic coding mode:
- Minor issues (style, small logic improvements): fix silently and log the change
- Breaking issues (bad interfaces, cascading logic errors, architectural problems): interrupt immediately and surface the issue to the user

Do not repeat what Gemini said. You own the final output.`

const geminiAgenticSystemPrompt = `You are Gemini, the Implementer in ChaosCode. In agentic mode you implement complete features, file by file.

Output your implementation using EXACTLY this format — no prose between files:

<chaosplan>
One paragraph: what you're building and which files you'll create.
</chaosplan>

<file path="relative/path/from/project/root/filename.ext">
complete file content here
</file>

<file path="another/file.ext">
complete file content here
</file>

Rules:
- Paths are relative to the project root (no leading slash)
- Every file must be complete and immediately usable — no TODOs, no ellipses
- Claude reviews each file in parallel as you write it`

const claudeAgenticReviewSystemPrompt = `You are Claude, Editor-in-Chief in ChaosCode. Review a single file that Gemini wrote as part of an agentic task.

Respond using EXACTLY this format:

<review>
<severity>none|minor|breaking</severity>
<issues>
- issue description (one per line, empty if none)
</issues>
<fixed>
complete corrected file content (only if you have changes, empty otherwise)
</fixed>
</review>

Severity guide:
- none: file is correct
- minor: style, naming, small logic improvements — fix silently
- breaking: bad interfaces, wrong architecture, logic errors that cascade — must interrupt`

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
      sandbox: false
    }
  })

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173')
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

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

ipcMain.handle('llm:gemini:agentic', async (event, userTask: string, requestId: string) => {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: geminiAgenticSystemPrompt
  })

  const chat = model.startChat({ history: [] })
  const result = await chat.sendMessageStream(userTask)

  let fullText = ''
  for await (const chunk of result.stream) {
    if (isCancelled(requestId)) { clearCancel(requestId); break }
    const token = chunk.text()
    fullText += token
    event.sender.send('llm:gemini:token', token)
  }
  event.sender.send('llm:gemini:done')
  return fullText
})

ipcMain.handle('llm:claude:agentic-review', async (
  _event,
  { filePath, content, userTask }: { filePath: string; content: string; userTask: string }
) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const anthropic = new Anthropic({ apiKey })
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 4096,
    system: claudeAgenticReviewSystemPrompt,
    messages: [{
      role: 'user',
      content: `User task: ${userTask}\n\nFile: \`${filePath}\`\n\`\`\`\n${content}\n\`\`\``
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

ipcMain.handle('llm:gemini', async (
  event,
  messages: Array<{ role: string; content: string }>,
  requestId: string
) => {
  const apiKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY
  if (!apiKey) throw new Error('GOOGLE_GENERATIVE_AI_API_KEY not set')

  const genAI = new GoogleGenerativeAI(apiKey)
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash',
    systemInstruction: geminiSystemPrompt
  })

  const history = messages.slice(0, -1).map((m) => ({
    role: m.role === 'user' ? 'user' : 'model',
    parts: [{ text: m.content }]
  }))
  const lastMessage = messages[messages.length - 1]

  const chat = model.startChat({ history })
  const result = await chat.sendMessageStream(lastMessage.content)

  let fullText = ''
  for await (const chunk of result.stream) {
    if (isCancelled(requestId)) { clearCancel(requestId); break }
    const token = chunk.text()
    fullText += token
    event.sender.send('llm:gemini:token', token)
  }

  event.sender.send('llm:gemini:done')
  return fullText
})

ipcMain.handle('llm:claude', async (
  event,
  messages: Array<{ role: string; content: string }>,
  requestId: string
) => {
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set')

  const anthropic = new Anthropic({ apiKey })

  const stream = anthropic.messages.stream({
    model: 'claude-sonnet-4-6',
    max_tokens: 8096,
    system: claudeSystemPrompt,
    messages: messages.map((m) => ({
      role: m.role as 'user' | 'assistant',
      content: m.content
    }))
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
      event.sender.send('llm:claude:token', token)
    }
  }

  event.sender.send('llm:claude:done')
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
