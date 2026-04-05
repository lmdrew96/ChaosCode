import { useState, useCallback, useRef } from 'react'
import MonacoEditorPanel from '@/components/Editor/MonacoEditor'
import FileTree from '@/components/FileTree/FileTree'
import LLMPanel from '@/components/LLMPanel/LLMPanel'
import { useAgenticMode } from '@/hooks/useAgenticMode'
import { openFileContextItem, fileTreeContextItem, buildLLMMessage } from '@/services/context'
import { contentToString } from '@/types'
import type { FileNode, LLMTarget, Message, OpenFile, ReviewEntry } from '@/types'

// Matches the Api type exposed by src/preload/index.ts
declare global {
  interface Window {
    api: {
      openFolder: () => Promise<string | null>
      readFile: (path: string) => Promise<string>
      writeFile: (path: string, content: string) => Promise<void>
      listDir: (path: string) => Promise<import('@/types').FileNode[]>
      cancelRequest: (requestId: string) => Promise<void>
      sendToGemini: (messages: { role: string; content: string }[], requestId: string) => Promise<string>
      sendToClaude: (messages: { role: string; content: string }[], requestId: string) => Promise<string>
      sendToGeminiAgentic: (userTask: string, requestId: string) => Promise<string>
      claudeAgenticReview: (args: { filePath: string; content: string; userTask: string }) => Promise<string>
      onGeminiToken: (cb: (token: string) => void) => void
      onGeminiDone: (cb: () => void) => void
      onClaudeToken: (cb: (token: string) => void) => void
      onClaudeDone: (cb: () => void) => void
      removeAllListeners: (channel: string) => void
    }
  }
}

// Infer Monaco language from file extension
function inferLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const map: Record<string, string> = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    json: 'json', md: 'markdown', css: 'css', html: 'html', py: 'python',
    rs: 'rust', go: 'go', sh: 'shell', yml: 'yaml', yaml: 'yaml',
    toml: 'toml', sql: 'sql', txt: 'plaintext',
  }
  return map[ext] ?? 'plaintext'
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export default function App() {
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string | undefined>()
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  // Extra files pinned as context (readable by agents but not open in editor)
  const [pinnedFiles, setPinnedFiles] = useState<OpenFile[]>([])
  const [messages, setMessages] = useState<Message[]>([])
  const [reviews, setReviews] = useState<ReviewEntry[]>([])
  const [target, setTarget] = useState<LLMTarget>('both')
  const [agenticMode, setAgenticMode] = useState(false)
  const [geminiStreaming, setGeminiStreaming] = useState(false)
  const [claudeStreaming, setClaudeStreaming] = useState(false)

  // Refs to accumulate streamed content without extra re-renders
  const geminiMsgId = useRef<string | null>(null)
  const claudeMsgId = useRef<string | null>(null)
  // Active request ID for cancellation (Continue-style AbortController adapted for IPC)
  const activeRequestId = useRef<string | null>(null)

  // --- File system ---

  async function refreshFileTree(path: string) {
    const nodes = await window.api.listDir(path)
    setFileTree(nodes)
  }

  async function handleOpenFolder() {
    const path = await window.api.openFolder()
    if (!path) return
    await refreshFileTree(path)
    setRootPath(path)
    setRootName(path.split('/').pop())
  }

  // Called by agentic mode when a file is written to disk
  const handleAgenticFileWritten = useCallback((_relativePath: string) => {
    if (rootPath) refreshFileTree(rootPath)
  }, [rootPath])

  const { agenticState, breakingIssue, dismissInterrupt, runAgenticTask } = useAgenticMode({
    rootPath,
    fileTree,
    openFile,
    setMessages,
    setReviews,
    onFileWritten: handleAgenticFileWritten,
  })

  async function handleFileSelect(node: FileNode) {
    if (node.type !== 'file') return
    const content = await window.api.readFile(node.path)
    setOpenFile({
      path: node.path,
      content,
      language: inferLanguage(node.name)
    })
  }

  /** Right-click / alt-click: add file to agent context without opening in editor */
  async function handlePinFile(node: FileNode) {
    if (node.type !== 'file') return
    const alreadyPinned = pinnedFiles.some((f) => f.path === node.path)
    if (alreadyPinned) {
      setPinnedFiles((prev) => prev.filter((f) => f.path !== node.path))
      return
    }
    const content = await window.api.readFile(node.path)
    setPinnedFiles((prev) => [
      ...prev,
      { path: node.path, content, language: inferLanguage(node.name) }
    ])
  }

  function handleEditorChange(content: string) {
    setOpenFile((prev) => prev ? { ...prev, content } : null)
  }

  // --- LLM ---

  /** Assemble ContextItem[] for the current IDE state */
  const buildContextItems = useCallback(() => {
    const items = []
    if (fileTree.length > 0 && rootPath) items.push(fileTreeContextItem(fileTree, rootPath))
    if (openFile) items.push(openFileContextItem(openFile))
    // Pinned files are included even when they're not the active editor file
    for (const f of pinnedFiles) {
      if (f.path !== openFile?.path) items.push(openFileContextItem(f))
    }
    return items
  }, [openFile, pinnedFiles, fileTree, rootPath])

  /** Cancel the currently active LLM request */
  function handleCancel() {
    if (!activeRequestId.current) return
    window.api.cancelRequest(activeRequestId.current)
    activeRequestId.current = null
    setGeminiStreaming(false)
    setClaudeStreaming(false)
  }

  async function handleSend(userText: string) {
    if (agenticMode) {
      return runAgenticTask(userText)
    }

    const userMsg: Message = {
      id: uid(), role: 'user', content: userText, timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])

    // Build context via the context service (Continue's ContextItem pattern)
    const contextItems = buildContextItems()
    const contextText = buildLLMMessage(userText, contextItems)

    const historyForLLM = [
      ...messages.map((m) => ({ role: m.role, content: contentToString(m.content) })),
      { role: 'user' as const, content: contextText }
    ]

    let geminiReply: string | null = null

    if (target === 'both' || target === 'gemini') {
      geminiReply = await runGemini(historyForLLM)
    }

    if (target === 'both' || target === 'claude') {
      if (target === 'both' && geminiReply === null) return

      const historyForClaude = geminiReply
        ? [
            ...historyForLLM.slice(0, -1),
            {
              role: 'user' as const,
              content: `${contextText}\n\n---\n[Gemini's response — review and own the final output]:\n${geminiReply}`
            }
          ]
        : historyForLLM
      await runClaude(historyForClaude)
    }
  }

  // Returns the full response text on success, null on error
  function runGemini(history: { role: string; content: string }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const msgId = uid()
      const requestId = uid()
      geminiMsgId.current = msgId
      activeRequestId.current = requestId

      setGeminiStreaming(true)
      setMessages((prev) => [...prev, {
        id: msgId, role: 'assistant', source: 'gemini', content: '', timestamp: Date.now()
      }])

      window.api.removeAllListeners('llm:gemini:token')
      window.api.removeAllListeners('llm:gemini:done')

      window.api.onGeminiToken((token) => {
        setMessages((prev) => prev.map((m) =>
          m.id === msgId ? { ...m, content: (contentToString(m.content)) + token } : m
        ))
      })

      window.api.sendToGemini(history, requestId)
        .then((fullText) => {
          setGeminiStreaming(false)
          activeRequestId.current = null
          resolve(fullText)
        })
        .catch((err) => {
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: `[Error: ${err.message}]` } : m
          ))
          setGeminiStreaming(false)
          activeRequestId.current = null
          resolve(null)
        })
    })
  }

  function runClaude(history: { role: string; content: string }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const msgId = uid()
      const requestId = uid()
      claudeMsgId.current = msgId
      activeRequestId.current = requestId

      setClaudeStreaming(true)
      setMessages((prev) => [...prev, {
        id: msgId, role: 'assistant', source: 'claude', content: '', timestamp: Date.now()
      }])

      window.api.removeAllListeners('llm:claude:token')
      window.api.removeAllListeners('llm:claude:done')

      window.api.onClaudeToken((token) => {
        setMessages((prev) => prev.map((m) =>
          m.id === msgId ? { ...m, content: (contentToString(m.content)) + token } : m
        ))
      })

      window.api.sendToClaude(history, requestId)
        .then((fullText) => {
          setClaudeStreaming(false)
          activeRequestId.current = null
          resolve(fullText)
        })
        .catch((err) => {
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: `[Error: ${err.message}]` } : m
          ))
          setClaudeStreaming(false)
          activeRequestId.current = null
          resolve(null)
        })
    })
  }

  return (
    <div className="flex flex-col h-screen bg-surface-0 text-white select-none">
      {/* Titlebar drag region */}
      <div
        className="flex items-center h-10 px-4 flex-shrink-0 border-b border-white/5"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="ml-16 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="text-[11px] font-semibold tracking-widest text-white/30 uppercase">ChaosCode</span>
          {openFile && (
            <>
              <span className="text-white/15">›</span>
              <span className="text-[11px] text-white/40 max-w-xs truncate">
                {openFile.path.split('/').pop()}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main 3-panel layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar — File tree */}
        <aside className="flex flex-col w-52 flex-shrink-0 border-r border-white/5 bg-surface-1 overflow-hidden">
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-2 px-3 py-2 text-[10px] text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors border-b border-white/5 flex-shrink-0"
          >
            <span>󰉋</span>
            <span className="uppercase tracking-widest">{rootName ?? 'Open Folder'}</span>
          </button>
          <FileTree
            nodes={fileTree}
            selectedPath={openFile?.path ?? null}
            pinnedPaths={pinnedFiles.map((f) => f.path)}
            onFileSelect={handleFileSelect}
            onPinFile={handlePinFile}
            rootName={undefined}
          />
        </aside>

        {/* Editor — center */}
        <main className="flex-1 overflow-hidden bg-surface-0">
          <MonacoEditorPanel
            file={openFile}
            onChange={handleEditorChange}
          />
        </main>

        {/* Right panel — LLM chat */}
        <aside className="flex flex-col w-96 flex-shrink-0 border-l border-white/5 bg-surface-1 overflow-hidden">
          <LLMPanel
            messages={messages}
            reviews={reviews}
            pinnedFiles={pinnedFiles}
            target={target}
            onTargetChange={setTarget}
            onSend={handleSend}
            onCancel={handleCancel}
            geminiStreaming={geminiStreaming}
            claudeStreaming={claudeStreaming}
            agenticMode={agenticMode}
            onAgenticModeChange={setAgenticMode}
            agenticState={agenticState}
            breakingIssue={breakingIssue}
            onDismissBreaking={dismissInterrupt}
          />
        </aside>
      </div>
    </div>
  )
}
