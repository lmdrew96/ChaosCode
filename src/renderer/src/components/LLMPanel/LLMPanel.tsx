import { useState, useRef, useEffect } from 'react'
import type { Message, LLMTarget, ReviewEntry, OpenFile } from '@/types'
import type { AgenticState, BreakingIssue } from '@/hooks/useAgenticMode'

interface Props {
  messages: Message[]
  reviews: ReviewEntry[]
  pinnedFiles: OpenFile[]
  target: LLMTarget
  onTargetChange: (t: LLMTarget) => void
  onSend: (text: string) => void
  onCancel: () => void
  geminiStreaming: boolean
  claudeStreaming: boolean
  agenticMode: boolean
  onAgenticModeChange: (v: boolean) => void
  agenticState: AgenticState
  breakingIssue: BreakingIssue | null
  onDismissBreaking: () => void
}

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user'
  const isGemini = msg.source === 'gemini'
  const isClaude = msg.source === 'claude'

  return (
    <div className={`flex flex-col gap-1 ${isUser ? 'items-end' : 'items-start'}`}>
      {!isUser && (
        <span className={`text-[10px] font-semibold uppercase tracking-wider px-1 ${
          isGemini ? 'text-accent-gemini/70' : 'text-accent-claude/70'
        }`}>
          {isGemini ? 'Gemini' : 'Claude'}
        </span>
      )}
      <div className={`max-w-[90%] rounded-lg px-3 py-2 text-xs leading-relaxed whitespace-pre-wrap break-words ${
        isUser
          ? 'bg-white/10 text-white/90'
          : isGemini
            ? 'bg-[#1a2a3a] border border-accent-gemini/20 text-white/85'
            : 'bg-[#2a1f0a] border border-accent-claude/20 text-white/85'
      }`}>
        {msg.content || <span className="animate-pulse opacity-40">▍</span>}
      </div>
    </div>
  )
}

const TARGETS: { value: LLMTarget; label: string }[] = [
  { value: 'both', label: 'Both' },
  { value: 'gemini', label: 'Gemini' },
  { value: 'claude', label: 'Claude' },
]

export default function LLMPanel({
  messages,
  reviews,
  pinnedFiles,
  target,
  onTargetChange,
  onSend,
  onCancel,
  geminiStreaming,
  claudeStreaming,
  agenticMode,
  onAgenticModeChange,
  agenticState,
  breakingIssue,
  onDismissBreaking,
}: Props) {
  const [input, setInput] = useState('')
  const [showReviews, setShowReviews] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const isAgenticBusy = agenticState.phase === 'implementing' || agenticState.phase === 'reviewing' || agenticState.phase === 'planning'
  const isBusy = geminiStreaming || claudeStreaming || isAgenticBusy

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

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
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white/20">
            {agenticMode ? 'Agentic' : 'Chat'}
          </span>
          <button
            onClick={() => onAgenticModeChange(!agenticMode)}
            title={agenticMode ? 'Switch to chat mode' : 'Switch to agentic mode'}
            className={`relative w-7 h-4 rounded-full transition-colors flex-shrink-0 ${
              agenticMode ? 'bg-accent-gemini/40' : 'bg-white/10'
            }`}
          >
            <span className={`absolute top-0.5 w-3 h-3 rounded-full transition-all ${
              agenticMode ? 'left-3.5 bg-accent-gemini' : 'left-0.5 bg-white/30'
            }`} />
          </button>
        </div>
        {!agenticMode && (
          <div className="flex gap-1 bg-white/5 rounded-md p-0.5">
            {TARGETS.map(({ value, label }) => (
              <button
                key={value}
                onClick={() => onTargetChange(value)}
                className={`px-2 py-0.5 text-[10px] rounded transition-all ${
                  target === value
                    ? value === 'gemini'
                      ? 'bg-accent-gemini/20 text-accent-gemini'
                      : value === 'claude'
                        ? 'bg-accent-claude/20 text-accent-claude'
                        : 'bg-white/15 text-white/80'
                    : 'text-white/30 hover:text-white/50'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Breaking issue interrupt alert */}
      {breakingIssue && (
        <div className="mx-2 mt-2 p-3 bg-red-950/60 border border-red-500/30 rounded-lg flex-shrink-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">
                ⚠ Claude interrupted — breaking issue
              </p>
              <p className="text-[10px] text-white/50 truncate">{breakingIssue.filePath}</p>
              {breakingIssue.issues.map((issue, i) => (
                <p key={i} className="text-[11px] text-red-300/80 mt-1 leading-relaxed">{issue}</p>
              ))}
            </div>
            <button
              onClick={onDismissBreaking}
              className="text-[10px] text-white/30 hover:text-white/60 flex-shrink-0 mt-0.5"
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Agentic progress bar */}
      {agenticMode && isAgenticBusy && (
        <div className="px-3 py-2 border-b border-white/5 flex-shrink-0">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] text-accent-gemini/70 flex items-center gap-1">
              <span className="animate-pulse">●</span>
              {agenticState.phase === 'planning' && 'Planning…'}
              {agenticState.phase === 'implementing' && `Writing${agenticState.currentFilePath ? `: ${agenticState.currentFilePath.split('/').pop()}` : '…'}`}
              {agenticState.phase === 'reviewing' && 'Claude reviewing all files…'}
            </span>
            {agenticState.filesWritten.length > 0 && (
              <span className="text-[10px] text-white/20">
                {agenticState.filesWritten.length} file{agenticState.filesWritten.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Chat status bar */}
      {!agenticMode && (geminiStreaming || claudeStreaming) && (
        <div className="flex gap-3 px-3 py-1.5 bg-white/3 border-b border-white/5 flex-shrink-0">
          {geminiStreaming && (
            <span className="text-[10px] text-accent-gemini/70 flex items-center gap-1">
              <span className="animate-pulse">●</span> Gemini writing…
            </span>
          )}
          {claudeStreaming && (
            <span className="text-[10px] text-accent-claude/70 flex items-center gap-1">
              <span className="animate-pulse">●</span> Claude reviewing…
            </span>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-2 select-none">
            <p className="text-[11px] text-white/15 text-center leading-relaxed">
              Gemini implements.<br />Claude reviews.<br />You direct.
            </p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} msg={msg} />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Review log toggle */}
      {reviews.length > 0 && (
        <button
          onClick={() => setShowReviews((v) => !v)}
          className="flex items-center justify-between px-3 py-1.5 border-t border-white/5 text-[10px] text-white/30 hover:text-white/50 transition-colors flex-shrink-0"
        >
          <span className="flex items-center gap-2">
            <span className="uppercase tracking-wider">Review Log</span>
            {breakingReviews > 0 && (
              <span className="px-1 bg-red-500/20 text-red-400 rounded text-[9px]">
                {breakingReviews} breaking
              </span>
            )}
            {pendingReviews > 0 && (
              <span className="px-1 bg-white/10 rounded text-[9px]">
                {pendingReviews} minor
              </span>
            )}
          </span>
          <span>{showReviews ? '▾' : '▸'}</span>
        </button>
      )}

      {showReviews && (
        <div className="max-h-32 overflow-y-auto border-t border-white/5 flex-shrink-0">
          {reviews.map((r) => (
            <div
              key={r.id}
              className={`px-3 py-1.5 text-[10px] border-b border-white/5 last:border-0 ${
                r.severity === 'breaking' ? 'text-red-400/80' : 'text-white/40'
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
              className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-accent-claude/10 border border-accent-claude/20 text-accent-claude/70 rounded"
              title={f.path}
            >
              <span className="opacity-60">@</span>
              {f.path.split('/').pop()}
            </span>
          ))}
        </div>
      )}

      {/* Input */}
      <div className="flex-shrink-0 border-t border-white/5 p-2">
        <div className="flex items-end gap-2 bg-white/5 rounded-lg p-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isBusy
                ? isAgenticBusy ? 'Agentic task running…' : 'Waiting for response…'
                : agenticMode
                  ? 'Describe a task for Gemini to implement…'
                  : 'Message (Enter to send, Shift+Enter for newline)'
            }
            disabled={isBusy}
            rows={1}
            className="flex-1 bg-transparent text-xs text-white/80 placeholder:text-white/20 resize-none outline-none leading-relaxed max-h-32 overflow-y-auto disabled:opacity-40"
            style={{ minHeight: '20px' }}
          />
          {isBusy ? (
            <button
              onClick={onCancel}
              title="Stop generation"
              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-all"
            >
              ■
            </button>
          ) : (
            <button
              onClick={submit}
              disabled={!input.trim()}
              className="flex-shrink-0 w-6 h-6 rounded flex items-center justify-center text-[10px] bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
            >
              ↑
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
