import { useState, useCallback, useRef, useEffect } from 'react'
import MonacoEditorPanel from '@/components/Editor/MonacoEditor'
import FileTree from '@/components/FileTree/FileTree'
import LLMPanel from '@/components/LLMPanel/LLMPanel'
import ErrorBoundary from '@/components/ErrorBoundary'
import { useAgenticMode } from '@/hooks/useAgenticMode'
import { useTheme, type ColorScheme, type ThemePreference } from '@/hooks/useTheme'
import { PANEL_HANDLE_WIDTH, useResizablePanels } from '@/hooks/useResizablePanels'
import { useSessionStorage, type StoredSession } from '@/hooks/useSessionStorage'
import {
  openFileContextItem,
  fileTreeContextItem,
  buildLLMMessage,
  buildAgenticCarryover,
  buildSonnetReviewMessage,
} from '@/services/context'
import { countLineDiff } from '@/services/lineDiff'
import { contentToString } from '@/types'
import type { FileNode, Message, OpenFile } from '@/types'
import useChatStore from '@/store/chatStore'

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

/**
 * Prunes message history to fit within a character budget before sending to the LLM.
 * Strategy: walk backwards from most recent, keep messages that fit, but always
 * preserve the first message (which typically contains the initial plan/task).
 * This prevents silent context overflow on long sessions.
 */
const HISTORY_CHAR_BUDGET = 24_000

const THEME_OPTIONS: { value: ThemePreference; label: string }[] = [
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
  { value: 'system', label: 'System' },
]

const COLOR_SCHEME_OPTIONS: { value: ColorScheme; label: string }[] = [
  { value: 'slate', label: 'Slate' },
  { value: 'nord', label: 'Nord' },
  { value: 'adhd', label: 'ADHD' },
]

function pruneMessages(msgs: Message[]): Message[] {
  if (msgs.length <= 1) return msgs

  let total = 0
  const recentIndices: number[] = []

  for (let i = msgs.length - 1; i >= 0; i--) {
    const chars = contentToString(msgs[i].content).length
    if (total + chars > HISTORY_CHAR_BUDGET && recentIndices.length > 0) break
    total += chars
    recentIndices.unshift(i)
  }

  // Always include the first message if it wasn't reached
  if (recentIndices[0] !== 0) {
    return [msgs[0], ...recentIndices.map((i) => msgs[i])]
  }

  return recentIndices.map((i) => msgs[i])
}

export default function App() {
  const layoutRef = useRef<HTMLDivElement>(null)
  const { theme, setTheme, resolvedTheme, colorScheme, setColorScheme } = useTheme()
  const [rootPath, setRootPath] = useState<string | null>(null)
  const [rootName, setRootName] = useState<string | undefined>()
  const [fileTree, setFileTree] = useState<FileNode[]>([])
  const [openFile, setOpenFile] = useState<OpenFile | null>(null)
  // Extra files pinned as context (readable by agents but not open in editor)
  const [pinnedFiles, setPinnedFiles] = useState<OpenFile[]>([])
  const {
    messages, setMessages,
    reviews, setReviews,
    target, setTarget,
    agenticMode, setAgenticMode,
    autoApprove, setAutoApprove,
    haikuStreaming, setHaikuStreaming,
    sonnetStreaming, setSonnetStreaming,
    estimatedTokens,
    haikuModel, setHaikuModel,
    sonnetModel, setSonnetModel,
  } = useChatStore()
  const { leftWidth, rightWidth, leftCollapsed, rightCollapsed, toggleCollapse, startResize } = useResizablePanels(layoutRef)
  const { sessions, activeSessionId, activeSession, saveSession, newSession, switchSession, deleteSession } = useSessionStorage()
  const [sessionsOpen, setSessionsOpen] = useState(false)
  // Prevents auto-save from firing while a session is being loaded into state
  const isLoadingSession = useRef(false)

  // Tracks the on-disk content of each file so Cmd+S can diff against it
  const savedContentRef = useRef<Map<string, string>>(new Map())
  const [manualDiffLines, setManualDiffLines] = useState<number[]>([])

  // Refs to accumulate streamed content without extra re-renders
  const haikuMsgId = useRef<string | null>(null)
  const sonnetMsgId = useRef<string | null>(null)
  // Active request ID for cancellation (Continue-style AbortController adapted for IPC)
  const activeRequestId = useRef<string | null>(null)

  // --- Session restore ---

  async function applySession(session: StoredSession) {
    isLoadingSession.current = true
    setMessages(session.messages ?? [])
    setReviews(session.reviews ?? [])
    setTarget(session.target ?? 'both')
    setAgenticMode(session.agenticMode ?? false)
    setRootPath(session.rootPath)
    setRootName(session.rootPath?.split('/').pop())

    if (session.rootPath) {
      const nodes = await window.api.listDir(session.rootPath).catch(() => [] as FileNode[])
      setFileTree(nodes)
    } else {
      setFileTree([])
    }

    if (session.openFilePath) {
      await window.api.readFile(session.openFilePath)
        .then((content) => {
          savedContentRef.current.set(session.openFilePath!, content)
          setOpenFile({
            path: session.openFilePath!,
            content,
            language: inferLanguage(session.openFilePath!.split('/').pop() ?? ''),
          })
        })
        .catch(() => setOpenFile(null))
    } else {
      setOpenFile(null)
    }

    if (session.pinnedFilePaths.length > 0) {
      const pinned = await Promise.all(
        session.pinnedFilePaths.map((path) =>
          window.api.readFile(path)
            .then((content): OpenFile => ({ path, content, language: inferLanguage(path.split('/').pop() ?? '') }))
            .catch(() => null)
        )
      )
      setPinnedFiles(pinned.filter((f): f is OpenFile => f !== null))
    } else {
      setPinnedFiles([])
    }

    isLoadingSession.current = false
  }

  // Load the active session once on mount
  useEffect(() => {
    if (activeSession) void applySession(activeSession)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Auto-save whenever session content changes (debounced inside saveSession)
  useEffect(() => {
    if (isLoadingSession.current) return
    saveSession(activeSessionId, {
      rootPath,
      openFilePath: openFile?.path ?? null,
      pinnedFilePaths: pinnedFiles.map((f) => f.path),
      messages,
      reviews,
      target,
      agenticMode,
    })
  }, [messages, reviews, rootPath, openFile?.path, pinnedFiles, target, agenticMode, activeSessionId, saveSession])

  // Clear manual diff highlights when the open file changes
  useEffect(() => {
    setManualDiffLines([])
  }, [openFile?.path])

  function updateManualDiff(path: string, content: string) {
    const before = savedContentRef.current.get(path) ?? ''
    setManualDiffLines(countLineDiff(before, content).addedLines)
  }

  // Cmd+S / Ctrl+S — write file to disk and highlight changed lines
  useEffect(() => {
    async function handleKeyDown(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey) || e.key !== 's') return
      e.preventDefault()
      if (!openFile) return
      await window.api.writeFile(openFile.path, openFile.content)
      const changed = countLineDiff(savedContentRef.current.get(openFile.path) ?? '', openFile.content).addedLines
      savedContentRef.current.set(openFile.path, openFile.content)
      setManualDiffLines(changed)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openFile])

  async function handleSwitchSession(id: string) {
    const session = switchSession(id)
    if (session) await applySession(session)
    setSessionsOpen(false)
  }

  async function handleNewSession() {
    const session = newSession()
    await applySession(session)
    setSessionsOpen(false)
  }

  async function handleDeleteSession(e: React.MouseEvent, id: string) {
    e.stopPropagation()
    const fallback = deleteSession(id)
    if (fallback) await applySession(fallback)
  }

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
  const handleAgenticFileWritten = useCallback(async (relativePath: string) => {
    if (rootPath) await refreshFileTree(rootPath)

    if (!rootPath || !openFile) return

    const writtenPath = `${rootPath}/${relativePath}`
    if (openFile.path !== writtenPath) return

    const savedContent = savedContentRef.current.get(writtenPath) ?? ''
    if (openFile.content !== savedContent) return

    const content = await window.api.readFile(writtenPath)
    savedContentRef.current.set(writtenPath, content)
    setOpenFile((prev) => (prev && prev.path === writtenPath ? { ...prev, content } : prev))
    setManualDiffLines([])
  }, [openFile, rootPath])

  const { agenticState, breakingIssue, dismissInterrupt, cancelAgenticTask, approvePlan, runAgenticTask } = useAgenticMode({
    rootPath,
    fileTree,
    openFile,
    onFileWritten: handleAgenticFileWritten,
  })

  async function handleFileSelect(node: FileNode) {
    if (node.type !== 'file') return
    const content = await window.api.readFile(node.path)
    savedContentRef.current.set(node.path, content)
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
    setOpenFile((prev) => {
      if (!prev) return null
      updateManualDiff(prev.path, content)
      return { ...prev, content }
    })
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
    if (agenticMode) {
      void cancelAgenticTask()
      return
    }

    if (!activeRequestId.current) return
    window.api.cancelRequest(activeRequestId.current)
    activeRequestId.current = null
    setHaikuStreaming(false)
    setSonnetStreaming(false)
  }

  async function handleSend(userText: string) {
    if (agenticMode) {
      const contextItems = buildContextItems()
      const historyForCarryover = pruneMessages(messages)
        .map((m) => ({ role: m.role, content: contentToString(m.content) }))

      return runAgenticTask(
        userText,
        buildAgenticCarryover(historyForCarryover, contextItems)
      )
    }

    const userMsg: Message = {
      id: uid(), role: 'user', content: userText, timestamp: Date.now()
    }
    setMessages((prev) => [...prev, userMsg])

    // Build context via the context service (Continue's ContextItem pattern)
    const contextItems = buildContextItems()
    const contextText = buildLLMMessage(userText, contextItems)

    const historyForLLM = [
      ...pruneMessages(messages).map((m) => ({ role: m.role, content: contentToString(m.content) })),
      { role: 'user' as const, content: contextText }
    ]

    let haikuReply: string | null = null

    if (target === 'both' || target === 'haiku') {
      haikuReply = await runHaiku(historyForLLM)
    }

    if (target === 'both' || target === 'sonnet') {
      if (target === 'both' && haikuReply === null) return

      const historyForSonnet = haikuReply
        ? [
            ...historyForLLM.slice(0, -1),
            {
              role: 'user' as const,
              content: buildSonnetReviewMessage(userText, haikuReply, contextItems),
            }
          ]
        : historyForLLM
      await runSonnet(historyForSonnet)
    }
  }

  // Returns the full response text on success, null on error
  function runHaiku(history: { role: string; content: string }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const msgId = uid()
      const requestId = uid()
      haikuMsgId.current = msgId
      activeRequestId.current = requestId

      setHaikuStreaming(true)
      setMessages((prev) => [...prev, {
        id: msgId, role: 'assistant', source: 'haiku', content: '', timestamp: Date.now()
      }])

      const unsubscribeHaikuToken = window.api.onHaikuToken((token) => {
        setMessages((prev) => prev.map((m) =>
          m.id === msgId ? { ...m, content: (contentToString(m.content)) + token } : m
        ))
      })

      window.api.sendToHaiku(history, requestId, rootPath, haikuModel)
        .then((fullText) => {
          unsubscribeHaikuToken()
          setHaikuStreaming(false)
          activeRequestId.current = null
          resolve(fullText)
        })
        .catch((err) => {
          unsubscribeHaikuToken()
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: `[Error: ${err.message}]` } : m
          ))
          setHaikuStreaming(false)
          activeRequestId.current = null
          resolve(null)
        })
    })
  }

  function runSonnet(history: { role: string; content: string }[]): Promise<string | null> {
    return new Promise((resolve) => {
      const msgId = uid()
      const requestId = uid()
      sonnetMsgId.current = msgId
      activeRequestId.current = requestId

      setSonnetStreaming(true)
      setMessages((prev) => [...prev, {
        id: msgId, role: 'assistant', source: 'sonnet', content: '', timestamp: Date.now()
      }])

      const unsubscribeSonnetToken = window.api.onSonnetToken((token) => {
        setMessages((prev) => prev.map((m) =>
          m.id === msgId ? { ...m, content: (contentToString(m.content)) + token } : m
        ))
      })

      window.api.sendToSonnet(history, requestId, rootPath, sonnetModel)
        .then((fullText) => {
          unsubscribeSonnetToken()
          setSonnetStreaming(false)
          activeRequestId.current = null
          resolve(fullText)
        })
        .catch((err) => {
          unsubscribeSonnetToken()
          setMessages((prev) => prev.map((m) =>
            m.id === msgId ? { ...m, content: `[Error: ${err.message}]` } : m
          ))
          setSonnetStreaming(false)
          activeRequestId.current = null
          resolve(null)
        })
    })
  }

  return (
    <div className="relative isolate flex flex-col h-screen bg-surface-0 text-primary">
      {/* Titlebar drag region */}
      <div
        className="relative z-20 flex items-center h-10 px-4 flex-shrink-0 border-b border-border/70 bg-surface-0/95 backdrop-blur select-none"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="ml-16 flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <span className="text-[11px] font-semibold tracking-widest text-secondary uppercase">ChaosCode</span>

          {/* Session switcher */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setSessionsOpen((v) => !v)}
              className="flex items-center gap-1 rounded px-2 py-0.5 text-[10px] text-subtle hover:text-primary hover:bg-surface-2 transition-colors"
            >
              <span className="max-w-[140px] truncate">{activeSession?.name ?? 'Session'}</span>
              <span className="text-[8px]">▾</span>
            </button>

            {sessionsOpen && (
              <>
                {/* Backdrop */}
                <div className="fixed inset-0 z-40" onClick={() => setSessionsOpen(false)} />
                {/* Dropdown */}
                <div className="absolute left-0 top-full mt-1 z-50 w-56 rounded-md border border-border bg-surface-1 shadow-lg overflow-hidden">
                  <button
                    type="button"
                    onClick={handleNewSession}
                    className="flex w-full items-center gap-2 px-3 py-2 text-[10px] text-secondary hover:text-primary hover:bg-surface-2 transition-colors border-b border-border/70"
                  >
                    <span>+</span>
                    <span className="uppercase tracking-widest">New Session</span>
                  </button>
                  <div className="max-h-64 overflow-y-auto">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className={`group flex items-center gap-1 px-3 py-2 cursor-pointer transition-colors ${
                          s.id === activeSessionId
                            ? 'bg-surface-2 text-primary'
                            : 'text-secondary hover:bg-surface-2 hover:text-primary'
                        }`}
                        onClick={() => void handleSwitchSession(s.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="text-[10px] truncate">{s.name}</div>
                          <div className="text-[9px] text-subtle truncate">
                            {s.messages.length} message{s.messages.length !== 1 ? 's' : ''}
                          </div>
                        </div>
                        {sessions.length > 1 && (
                          <button
                            type="button"
                            onClick={(e) => void handleDeleteSession(e, s.id)}
                            className="ml-1 flex-shrink-0 opacity-0 group-hover:opacity-100 rounded px-1 text-[10px] text-subtle hover:text-primary transition-opacity"
                            title="Delete session"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          {openFile && (
            <>
              <span className="text-border/70">›</span>
              <span className="text-[11px] text-secondary max-w-xs truncate">
                {openFile.path.split('/').pop()}
              </span>
            </>
          )}
        </div>

        <div className="ml-auto flex items-center gap-3" style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          {estimatedTokens > 0 && (
            <span className="text-[9px] tabular-nums text-subtle" title="Estimated token usage this session">
              ~{estimatedTokens >= 1000 ? `${(estimatedTokens / 1000).toFixed(1)}k` : estimatedTokens} tok
            </span>
          )}
          <span className="text-[9px] uppercase tracking-[0.3em] text-subtle">Style</span>
          <div className="flex items-center rounded-full border border-border bg-surface-1 p-0.5 shadow-sm">
            {COLOR_SCHEME_OPTIONS.map(({ value, label }) => {
              const isActive = colorScheme === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setColorScheme(value)}
                  title={`${label} color scheme`}
                  className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] transition-colors ${
                    isActive
                      ? 'bg-surface-3 text-primary shadow'
                      : 'text-secondary hover:bg-surface-2 hover:text-primary'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
          <span className="text-[9px] uppercase tracking-[0.3em] text-subtle">Theme</span>
          <div className="flex items-center rounded-full border border-border bg-surface-1 p-0.5 shadow-sm">
            {THEME_OPTIONS.map(({ value, label }) => {
              const isActive = theme === value
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={isActive}
                  onClick={() => setTheme(value)}
                  title={value === 'system' ? `System theme (${resolvedTheme})` : `${label} theme`}
                  className={`rounded-full px-2.5 py-1 text-[9px] font-semibold uppercase tracking-[0.2em] transition-colors ${
                    isActive
                      ? 'bg-surface-3 text-primary shadow'
                      : 'text-secondary hover:bg-surface-2 hover:text-primary'
                  }`}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Main 3-panel layout */}
      <div ref={layoutRef} className="relative z-0 flex flex-1 overflow-hidden min-w-0">
        {/* Sidebar — File tree */}
        <aside
          className="relative z-10 flex flex-col flex-shrink-0 border-r border-border/70 bg-surface-1 overflow-hidden min-w-0 select-none"
          style={{ width: leftCollapsed ? '0px' : `${leftWidth}px` }}
        >
          <button
            onClick={handleOpenFolder}
            className="flex items-center gap-2 px-3 py-2 text-[10px] text-secondary hover:text-primary hover:bg-surface-2 transition-colors border-b border-border/70 flex-shrink-0"
          >
            <span>󰉋</span>
            <span className="uppercase tracking-widest">{rootName ?? 'Open Folder'}</span>
          </button>
          <FileTree
            nodes={fileTree}
            selectedPath={openFile?.path ?? null}
            pinnedPaths={pinnedFiles.map((f) => f.path)}
            fileDiffs={agenticState.fileDiffs}
            onFileSelect={handleFileSelect}
            onPinFile={handlePinFile}
            rootName={undefined}
          />
        </aside>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize file tree panel"
          onPointerDown={startResize('left')}
          className="group relative z-20 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-surface-2 transition-colors touch-none"
          style={{ width: `${PANEL_HANDLE_WIDTH}px` }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 group-hover:bg-accent-gemini/50 transition-colors" />
          <button
            type="button"
            aria-label={leftCollapsed ? 'Expand file tree panel' : 'Collapse file tree panel'}
            title={leftCollapsed ? 'Expand file tree panel' : 'Collapse file tree panel'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => toggleCollapse('left')}
            className="absolute left-1/2 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-[9px] text-secondary shadow-sm hover:border-border-strong hover:text-primary transition-colors"
          >
            {leftCollapsed ? '▶' : '◀'}
          </button>
        </div>

        {/* Editor — center */}
        <main className="relative z-0 flex-1 min-w-0 overflow-hidden bg-surface-0">
          <ErrorBoundary label="Editor">
            <MonacoEditorPanel
              file={openFile}
              onChange={handleEditorChange}
              theme={resolvedTheme}
              colorScheme={colorScheme}
              addedLines={openFile ? (manualDiffLines.length ? manualDiffLines : agenticState.fileDiffs[openFile.path]?.addedLines) : undefined}
            />
          </ErrorBoundary>
        </main>

        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize chat panel"
          onPointerDown={startResize('right')}
          className="group relative z-20 flex-shrink-0 cursor-col-resize bg-transparent hover:bg-surface-2 transition-colors touch-none"
          style={{ width: `${PANEL_HANDLE_WIDTH}px` }}
        >
          <div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/70 group-hover:bg-accent-claude/50 transition-colors" />
          <button
            type="button"
            aria-label={rightCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
            title={rightCollapsed ? 'Expand chat panel' : 'Collapse chat panel'}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={() => toggleCollapse('right')}
            className="absolute left-1/2 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-border bg-surface-1 text-[9px] text-secondary shadow-sm hover:border-border-strong hover:text-primary transition-colors"
          >
            {rightCollapsed ? '◀' : '▶'}
          </button>
        </div>

        {/* Right panel — LLM chat */}
        <aside
          className="relative z-10 flex flex-col flex-shrink-0 border-l border-border/70 bg-surface-1 overflow-hidden min-w-0"
          style={{ width: rightCollapsed ? '0px' : `${rightWidth}px` }}
        >
          <ErrorBoundary label="Chat panel">
            <LLMPanel
              messages={messages}
              reviews={reviews}
              pinnedFiles={pinnedFiles}
              rootPath={rootPath}
              target={target}
              onTargetChange={setTarget}
              onSend={handleSend}
              onCancel={handleCancel}
              haikuStreaming={haikuStreaming}
              sonnetStreaming={sonnetStreaming}
              agenticMode={agenticMode}
              onAgenticModeChange={setAgenticMode}
              autoApprove={autoApprove}
              onAutoApproveChange={setAutoApprove}
              agenticState={agenticState}
              breakingIssue={breakingIssue}
              onDismissBreaking={dismissInterrupt}
              onApprovePlan={approvePlan}
              theme={resolvedTheme}
              colorScheme={colorScheme}
              haikuModel={haikuModel}
              sonnetModel={sonnetModel}
              onHaikuModelChange={setHaikuModel}
              onSonnetModelChange={setSonnetModel}
            />
          </ErrorBoundary>
        </aside>
      </div>
    </div>
  )
}
