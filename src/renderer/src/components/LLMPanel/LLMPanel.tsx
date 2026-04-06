import { useState, useRef, useEffect, useCallback } from 'react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { Message, LLMTarget, ReviewEntry, OpenFile, MessagePart } from '@/types'
import type { AgenticState, BreakingIssue } from '@/hooks/useAgenticMode'
import type { ResolvedTheme } from '@/hooks/useTheme'
import TerminalPanel from '@/components/Terminal/TerminalPanel'
import './markdown.css'

interface Props {
  messages: Message[]
  reviews: ReviewEntry[]
  pinnedFiles: OpenFile[]
  rootPath: string | null
  target: LLMTarget
  onTargetChange: (t: LLMTarget) => void
  onSend: (text: string) => void
  onCancel: () => void
  haikuStreaming: boolean
  sonnetStreaming: boolean
  agenticMode: boolean
  onAgenticModeChange: (v: boolean) => void
  agenticState: AgenticState
  breakingIssue: BreakingIssue | null
  onDismissBreaking: () => void
  theme: ResolvedTheme
}

function MessageBubble({ msg, theme }: { msg: Message; theme: ResolvedTheme }) {
  const isUser = msg.role === 'user'
  const isHaiku = msg.source === 'haiku'
  const parts: MessagePart[] = typeof msg.content === 'string' ? [{ type: 'text', text: msg.content }] : msg.content
  const syntaxTheme = theme === 'dark' ? atomDark : vs

  function renderText(text: string) {
    if (!text) return <span className="animate-pulse opacity-40">▍</span>

    return (
      <div className="markdown-content">
        <ReactMarkdown
          components={{
            code({ inline, className, children, ...props }: any) {
              const match = /language-(\w+)/.exec(className || '')
              const language = match ? match[1] : 'text'

              if (inline) {
                return (
                  <code className="bg-surface-2 px-1.5 py-0.5 rounded text-[11px] font-mono text-primary" {...props}>
                    {children}
                  </code>
                )
              }

              return (
                <div className="my-2 rounded-lg overflow-hidden">
                  <SyntaxHighlighter
                    language={language}
                    style={syntaxTheme}
                    customStyle={{
                      backgroundColor: theme === 'dark' ? 'rgba(15, 15, 15, 0.55)' : 'rgba(255, 255, 255, 0.95)',
                      padding: '12px',
                      borderRadius: '6px',
                      fontSize: '11px',
                      lineHeight: '1.5',
                    }}
                    {...props}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                </div>
              )
            },
            a({ children, ...props }: any) {
              return (
                <a
                  className="text-accent-gemini hover:text-accent-gemini/80 underline"
                  target="_blank"
                  rel="noopener noreferrer"
                  {...props}
                >
                  {children}
                </a>
              )
            },
            ul({ children, ...props }: any) {
              return (
                <ul className="list-disc list-inside my-2 space-y-1" {...props}>
                  {children}
                </ul>
              )
            },
            ol({ children, ...props }: any) {
              return (
                <ol className="list-decimal list-inside my-2 space-y-1" {...props}>
                  {children}
                </ol>
              )
            },
            strong({ children, ...props }: any) {
              return (
                <strong className="font-semibold text-primary" {...props}>
                  {children}
                </strong>
              )
            },
            em({ children, ...props }: any) {
              return (
                <em className="italic text-secondary" {...props}>
                  {children}
                </em>
              )
            },
            blockquote({ children, ...props }: any) {
              return (
                <blockquote className="border-l-2 border-border pl-3 my-2 text-secondary" {...props}>
                  {children}
                </blockquote>
              )
            },
            h1({ children, ...props }: any) {
              return (
                <h1 className="text-sm font-bold mt-3 mb-2" {...props}>
                  {children}
                </h1>
              )
            },
            h2({ children, ...props }: any) {
              return (
                <h2 className="text-[12px] font-bold mt-2.5 mb-1.5" {...props}>
                  {children}
                </h2>
              )
            },
            h3({ children, ...props }: any) {
              return (
                <h3 className="text-[11px] font-semibold mt-2 mb-1" {...props}>
                  {children}
                </h3>
              )
            },
            p({ children, ...props }: any) {
              return (
                <p className="my-1 text-primary" {...props}>
                  {children}
                </p>
              )
            },
          }}
        >
          {text}
        </ReactMarkdown>
      </div>
    )
  }

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {!isUser && (
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1 ${
          isHaiku ? 'text-accent-gemini' : 'text-accent-claude'
        }`}>
          {isHaiku ? 'Haiku' : 'Sonnet'}
        </span>
      )}
      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed break-words ${
        isUser
          ? 'bg-surface-2 text-primary border border-border'
          : isHaiku
            ? 'bg-accent-gemini/10 border border-accent-gemini/25 text-primary'
            : 'bg-accent-claude/10 border border-accent-claude/25 text-primary'
      }`}>
        <div className="flex flex-col gap-2">
          {parts.map((part, index) => {
            if (part.type === 'text') {
              return <div key={`${msg.id}-text-${index}`}>{renderText(part.text)}</div>
            }

            if (part.type === 'image') {
              return (
                <div
                  key={`${msg.id}-image-${index}`}
                  className="text-[10px] rounded border border-border bg-surface-2 px-2 py-1 text-secondary"
                >
                  image: {part.url}
                </div>
              )
            }

            if (part.type === 'tool_use') {
              const isRunCommand = part.toolUse.name === 'run_command'
              return (
                <div
                  key={`${msg.id}-tool-use-${part.toolUse.id}`}
                  className="rounded border border-accent-gemini/25 bg-accent-gemini/10 px-2 py-1.5"
                >
                  <div className="text-[9px] uppercase tracking-wider text-accent-gemini">Tool Call</div>
                  <div className="text-[11px] text-primary">{part.toolUse.name}</div>
                  <div className="text-[10px] text-muted mt-0.5 font-mono">
                    {isRunCommand
                      ? String(part.toolUse.input.command ?? '')
                      : String(part.toolUse.input.path ?? '')}
                  </div>
                </div>
              )
            }

            if (part.type === 'terminal_output') {
              const { command, stdout, stderr, exitCode } = part.terminalOutput
              const success = exitCode === 0
              return (
                <div
                  key={`${msg.id}-terminal-${index}`}
                  className="rounded border border-border bg-surface-0 overflow-hidden font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between px-2 py-1 bg-surface-2 border-b border-border/70">
                    <span className="text-muted">$ {command}</span>
                    <span className={success ? 'text-green-400' : 'text-danger'}>
                      exit {exitCode}
                    </span>
                  </div>
                  {stdout && (
                    <pre className="px-2 py-1.5 text-secondary whitespace-pre-wrap break-all max-h-48 overflow-y-auto leading-relaxed">
                      {stdout}
                    </pre>
                  )}
                  {stderr && (
                    <pre className="px-2 py-1.5 text-danger/80 whitespace-pre-wrap break-all border-t border-border/70 leading-relaxed">
                      {stderr}
                    </pre>
                  )}
                </div>
              )
            }

            return (
              <div
                key={`${msg.id}-tool-result-${part.toolResult.toolUseId}-${index}`}
                className={`rounded border px-2 py-1.5 ${
                  part.toolResult.isError
                    ? 'border-danger/30 bg-danger/10'
                    : 'border-accent-claude/25 bg-accent-claude/10'
                }`}
              >
                <div className={`text-[9px] uppercase tracking-wider ${part.toolResult.isError ? 'text-danger' : 'text-accent-claude'}`}>
                  Tool Result
                </div>
                <div className={`text-[10px] mt-0.5 leading-relaxed ${part.toolResult.isError ? 'text-danger/90' : 'text-secondary'}`}>
                  {part.toolResult.content}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

const TARGETS: { value: LLMTarget; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'haiku', label: 'Haiku Planner' },
  { value: 'sonnet', label: 'Sonnet Reviewer' },
]

export default function LLMPanel({
  messages,
  reviews,
  pinnedFiles,
  rootPath,
  target,
  onTargetChange,
  onSend,
  onCancel,
  haikuStreaming,
  sonnetStreaming,
  agenticMode,
  onAgenticModeChange,
  agenticState,
  breakingIssue,
  onDismissBreaking,
  theme,
}: Props) {
  const [input, setInput] = useState('')
  const [showReviews, setShowReviews] = useState(false)
  const [showJumpToLatest, setShowJumpToLatest] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(false)
  const [terminalHeight, setTerminalHeight] = useState(200)
  const terminalDragRef = useRef<{ startY: number; startH: number } | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const autoFollowRef = useRef(true)
  const isAgenticBusy = agenticState.phase === 'implementing' || agenticState.phase === 'reviewing' || agenticState.phase === 'planning'
  const isBusy = haikuStreaming || sonnetStreaming || isAgenticBusy

  const isNearBottom = useCallback(() => {
    const container = scrollContainerRef.current
    if (!container) return true
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom <= 80
  }, [])

  const scrollToBottom = useCallback((behavior: ScrollBehavior = 'smooth') => {
    bottomRef.current?.scrollIntoView({ behavior })
  }, [])

  const handleMessagesScroll = useCallback(() => {
    const nearBottom = isNearBottom()
    autoFollowRef.current = nearBottom
    if (nearBottom) {
      setShowJumpToLatest(false)
    }
  }, [isNearBottom])

  useEffect(() => {
    if (autoFollowRef.current || isNearBottom()) {
      autoFollowRef.current = true
      setShowJumpToLatest(false)
      scrollToBottom('smooth')
      return
    }

    if (messages.length > 0) {
      setShowJumpToLatest(true)
    }
  }, [messages, isNearBottom, scrollToBottom])

  function handleTerminalDragStart(e: React.PointerEvent) {
    e.preventDefault()
    terminalDragRef.current = { startY: e.clientY, startH: terminalHeight }
    window.addEventListener('pointermove', handleTerminalDragMove)
    window.addEventListener('pointerup', handleTerminalDragEnd)
  }

  function handleTerminalDragMove(e: PointerEvent) {
    if (!terminalDragRef.current) return
    const delta = terminalDragRef.current.startY - e.clientY
    const next = Math.max(100, Math.min(500, terminalDragRef.current.startH + delta))
    setTerminalHeight(next)
  }

  function handleTerminalDragEnd() {
    terminalDragRef.current = null
    window.removeEventListener('pointermove', handleTerminalDragMove)
    window.removeEventListener('pointerup', handleTerminalDragEnd)
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  function submit() {
    const text = input.trim()
    if (!text || isBusy) return
    onSend(text)
    setInput('')
  }

  const pendingReviews = reviews.filter((r) => r.severity === 'minor').length
  const breakingReviews = reviews.filter((r) => r.severity === 'breaking').length

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/70 flex-shrink-0 bg-surface-1/95 backdrop-blur">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-subtle">
            {agenticMode ? 'Agentic' : 'Chat'}
          </span>
          <button
            onClick={() => onAgenticModeChange(!agenticMode)}
            title={agenticMode ? 'Switch to chat mode' : 'Switch to agentic mode'}
            className={`relative w-7 h-4 rounded-full transition-colors flex-shrink-0 ${
              agenticMode ? 'bg-accent-gemini/40' : 'bg-surface-2'
            }`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
              agenticMode ? 'left-3.5 bg-accent-gemini' : 'left-0.5 bg-surface-4'
            }`} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          {!agenticMode && (
            <div className="flex gap-1 bg-surface-2 rounded-md p-0.5 border border-border/70">
              {TARGETS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => onTargetChange(value)}
                  className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                    target === value
                      ? value === 'haiku'
                        ? 'bg-accent-gemini/20 text-accent-gemini'
                        : value === 'sonnet'
                          ? 'bg-accent-claude/20 text-accent-claude'
                          : 'bg-surface-3 text-primary'
                      : 'text-secondary hover:text-primary'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => setTerminalOpen((v) => !v)}
            title={terminalOpen ? 'Hide terminal' : 'Show terminal'}
            className={`px-2 py-0.5 text-[10px] rounded border transition-all font-mono ${
              terminalOpen
                ? 'bg-surface-3 border-border text-primary'
                : 'border-border/50 text-secondary hover:text-primary hover:border-border'
            }`}
          >
            &gt;_
          </button>
        </div>
      </div>

      {agenticMode && (
        <div className="px-3 py-2 border-b border-border/70 text-[10px] text-secondary leading-relaxed">
          <span className="uppercase tracking-wider text-subtle mr-2">Workflow</span>
          <span className="text-accent-gemini">Haiku Planner</span>
          <span className="mx-1 text-subtle">→</span>
          <span className="text-accent-claude">Sonnet Reviewer</span>
          <span className="mx-1 text-subtle">→</span>
          <span className="text-accent-gemini">Haiku Implementer</span>
          <span className="mx-1 text-subtle">→</span>
          <span className="text-accent-claude">Sonnet Final Reviewer</span>
        </div>
      )}

      {/* Breaking issue interrupt alert */}
      {breakingIssue && (
        <div className="mx-2 mt-2 p-3 bg-danger/10 border border-danger/30 rounded-lg flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-danger uppercase tracking-wider mb-1">
                ⚠ Sonnet interrupted — breaking issue
              </p>
              <p className="text-[10px] text-muted truncate">{breakingIssue.filePath}</p>
              {breakingIssue.issues.map((issue, i) => (
                <p key={i} className="text-[11px] text-danger/90 mt-1 leading-relaxed">{issue}</p>
              ))}
            </div>
            <button
              onClick={onDismissBreaking}
              className="text-[10px] text-subtle hover:text-primary flex-shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Agentic progress bar */}
      {agenticMode && isAgenticBusy && (
        <div className="px-3 py-2 border-b border-border/70 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-accent-gemini flex items-center gap-1">
              <span className="animate-pulse">●</span>
              {agenticState.phase === 'planning' && 'Haiku Planner planning…'}
              {agenticState.phase === 'implementing' && `Haiku Implementer writing${agenticState.currentFilePath ? `: ${agenticState.currentFilePath.split('/').pop()}` : '…'}`}
              {agenticState.phase === 'reviewing' && 'Sonnet Reviewer reviewing all files…'}
            </span>
            {agenticState.filesWritten.length > 0 && (
              <span className="text-[10px] text-subtle">
                {agenticState.filesWritten.length} file{agenticState.filesWritten.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {agenticState.reviewingFiles.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] text-accent-claude flex items-center gap-1 shrink-0">
                <span className="animate-pulse">●</span>
                Sonnet Final Reviewer reviewing {agenticState.reviewingFiles.length} file{agenticState.reviewingFiles.length !== 1 ? 's' : ''}
              </span>
              {agenticState.reviewingFiles.slice(0, 3).map((filePath) => (
                <span
                  key={filePath}
                  className="px-1.5 py-0.5 text-[9px] rounded bg-accent-claude/10 border border-accent-claude/25 text-accent-claude truncate max-w-[10rem]"
                  title={filePath}
                >
                  {filePath.split('/').pop()}
                </span>
              ))}
              {agenticState.reviewingFiles.length > 3 && (
                <span className="px-1.5 py-0.5 text-[9px] rounded bg-surface-2 text-secondary">
                  +{agenticState.reviewingFiles.length - 3}
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Chat status bar */}
      {!agenticMode && (haikuStreaming || sonnetStreaming) && (
        <div className="flex gap-3 px-3 py-1.5 bg-surface-2/70 border-b border-border/70 flex-shrink-0">
          {haikuStreaming && (
            <span className="text-[10px] text-accent-gemini flex items-center gap-1">
              <span className="animate-pulse">●</span> Haiku writing…
            </span>
          )}
          {sonnetStreaming && (
            <span className="text-[10px] text-accent-claude flex items-center gap-1">
              <span className="animate-pulse">●</span> Sonnet reviewing…
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="relative flex-1 min-h-0">
        <div
          ref={scrollContainerRef}
          onScroll={handleMessagesScroll}
          className="h-full overflow-y-auto px-3 py-3 flex flex-col gap-3"
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
              <p className="text-[11px] text-muted text-center leading-relaxed">
                Haiku Planner plans.<br />Sonnet Reviewer reviews.<br />Haiku Implementer writes.<br />Sonnet Final Reviewer signs off.
              </p>
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} theme={theme} />
          ))}
          <div ref={bottomRef} />
        </div>

        {showJumpToLatest && (
          <button
            onClick={() => {
              autoFollowRef.current = true
              setShowJumpToLatest(false)
              scrollToBottom('smooth')
            }}
            className="absolute bottom-3 right-3 px-2 py-1 text-[10px] rounded-md border border-border/70 bg-surface-1/95 text-secondary hover:text-primary hover:border-border-strong transition-colors"
          >
            Jump to latest
          </button>
        )}
      </div>

      {/* Review log toggle */}
      {reviews.length > 0 && (
        <button
          onClick={() => setShowReviews((v) => !v)}
          className="flex items-center justify-between px-3 py-1.5 border-t border-border/70 text-[10px] text-secondary hover:text-primary transition-colors flex-shrink-0"
        >
          <span className="flex items-center gap-2">
            <span className="uppercase tracking-wider">Review Log</span>
            {breakingReviews > 0 && (
              <span className="px-1 bg-danger/10 text-danger rounded text-[9px]">
                {breakingReviews} breaking
              </span>
            )}
            {pendingReviews > 0 && (
              <span className="px-1 bg-surface-2 rounded text-[9px] text-primary">
                {pendingReviews} minor
              </span>
            )}
          </span>
          <span>{showReviews ? '▾' : '▸'}</span>
        </button>
      )}

      {showReviews && (
        <div className="max-h-32 overflow-y-auto border-t border-border/70 flex-shrink-0">
          {reviews.map((r) => (
            <div
              key={r.id}
              className={`px-3 py-1.5 text-[10px] border-b border-border/70 last:border-0 ${
                r.severity === 'breaking' ? 'text-danger' : 'text-secondary'
              }`}
            >
              <span className="uppercase tracking-wider mr-2 opacity-60">
                {r.severity === 'breaking' ? '⚠' : '✎'}
              </span>
              {r.description}
            </div>
          ))}
        </div>
      )}

      {/* Context chips — pinned files visible to agents */}
      {pinnedFiles.length > 0 && (
        <div className="flex flex-wrap gap-1 px-2 pt-2 flex-shrink-0">
          {pinnedFiles.map((f) => (
            <span
              key={f.path}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-accent-claude/10 border border-accent-claude/25 text-accent-claude rounded"
              title={f.path}
            >
              <span className="opacity-60">@</span>
              {f.path.split('/').pop()}
            </span>
          ))}
        </div>
      )}

      {/* Terminal panel */}
      {terminalOpen && (
        <div className="flex flex-col flex-shrink-0 border-t border-border/70 bg-surface-0" style={{ height: terminalHeight }}>
          {/* Drag handle */}
          <div
            onPointerDown={handleTerminalDragStart}
            className="flex items-center justify-between px-3 py-1 border-b border-border/70 bg-surface-1 cursor-ns-resize select-none flex-shrink-0"
          >
            <span className="text-[9px] uppercase tracking-widest text-subtle font-mono">Terminal</span>
            <span className="text-[9px] text-subtle opacity-40">⠿</span>
          </div>
          <div className="flex-1 min-h-0 p-1">
            <TerminalPanel cwd={rootPath ?? undefined} theme={theme} />
          </div>
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-border/70 p-2 bg-surface-1/95">
        <div className="flex items-end gap-2 bg-surface-2 rounded-lg p-2 border border-border/70">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isBusy
                ? isAgenticBusy ? 'Agentic task running... You can keep typing.' : 'Streaming response... You can keep typing.'
                : agenticMode
                  ? 'Describe a task for Haiku Implementer to implement…'
                  : 'Message (Enter to send, Shift+Enter for newline)'
            }
            rows={1}
            className="flex-1 bg-transparent text-xs text-primary placeholder:text-subtle resize-none outline-none leading-relaxed max-h-32 overflow-y-auto"
            style={{ minHeight: '20px' }}
          />
          {isBusy ? (
            <button
              onClick={onCancel}
              title="Stop generation"
              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] bg-danger/10 text-danger hover:bg-danger/20 transition-all"
            >
              ■
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] bg-surface-3 text-primary hover:bg-surface-4 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
