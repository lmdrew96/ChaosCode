import { useState } from 'react'
import type { ToolUsePart, ToolResultPart } from '@/types'

interface Props {
  toolUse: ToolUsePart
  toolResult: ToolResultPart | null // null = still running
}

function getInputPreview(toolUse: ToolUsePart): string {
  const { name, input } = toolUse.toolUse
  if (name === 'run_command') return String(input.command ?? '')
  if (name === 'persist_and_review') return String(input.path ?? '')
  if (name === 'read_file') return String(input.path ?? '')
  const first = Object.values(input)[0]
  return first != null ? String(first) : ''
}

function StatusIcon({ toolResult }: { toolResult: ToolResultPart | null }) {
  if (!toolResult) {
    return (
      <span className="inline-block w-3 h-3 rounded-full border border-accent-gemini/60 animate-spin border-t-transparent" />
    )
  }
  if (toolResult.toolResult.isError) {
    return <span className="text-danger text-[11px]">✗</span>
  }
  return <span className="text-green-400 text-[11px]">✓</span>
}

export default function StepContainer({ toolUse, toolResult }: Props) {
  const [expanded, setExpanded] = useState(false)
  const { name, input } = toolUse.toolUse
  const preview = getInputPreview(toolUse)
  const isRunning = toolResult === null
  const isError = toolResult?.toolResult.isError ?? false

  const borderColor = isRunning
    ? 'border-accent-gemini/30'
    : isError
      ? 'border-danger/30'
      : 'border-accent-gemini/20'

  const bgColor = isRunning
    ? 'bg-accent-gemini/5'
    : isError
      ? 'bg-danger/5'
      : 'bg-accent-gemini/5'

  return (
    <div className={`rounded border ${borderColor} ${bgColor} overflow-hidden`}>
      {/* Header row — always visible */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-white/5 transition-colors"
      >
        <StatusIcon toolResult={toolResult} />
        <span className="text-[10px] uppercase tracking-wider text-accent-gemini font-semibold shrink-0">
          {name}
        </span>
        {preview && (
          <span className="text-[10px] text-muted font-mono truncate flex-1 min-w-0">
            {preview}
          </span>
        )}
        <span className="text-[9px] text-subtle shrink-0">{expanded ? '▾' : '▸'}</span>
      </button>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border/50 text-[10px] font-mono">
          {/* Input */}
          {name !== 'persist_and_review' && (
            <div className="px-2 py-1.5 border-b border-border/30">
              <div className="text-[9px] uppercase tracking-wider text-subtle mb-1">Input</div>
              <pre className="text-secondary whitespace-pre-wrap break-all leading-relaxed max-h-32 overflow-y-auto">
                {JSON.stringify(input, null, 2)}
              </pre>
            </div>
          )}
          {/* Result */}
          {toolResult && (
            <div className="px-2 py-1.5">
              <div className={`text-[9px] uppercase tracking-wider mb-1 ${isError ? 'text-danger' : 'text-subtle'}`}>
                {isError ? 'Error' : 'Result'}
              </div>
              <pre className={`whitespace-pre-wrap break-all leading-relaxed max-h-40 overflow-y-auto ${isError ? 'text-danger/80' : 'text-secondary'}`}>
                {toolResult.toolResult.content}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
