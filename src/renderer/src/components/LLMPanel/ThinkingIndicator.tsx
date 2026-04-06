import type { AgenticPhase } from '@/hooks/useAgenticMode'

interface Props {
  phase: AgenticPhase
}

const PHASE_LABELS: Partial<Record<AgenticPhase, string>> = {
  planning: 'Planning…',
  implementing: 'Implementing…',
  reviewing: 'Reviewing…',
}

export default function ThinkingIndicator({ phase }: Props) {
  const label = PHASE_LABELS[phase]
  if (!label) return null

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <span className="flex gap-0.5">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="inline-block w-1 h-1 rounded-full bg-accent-gemini/60 animate-bounce"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      <span className="text-[10px] text-accent-gemini/80">{label}</span>
    </div>
  )
}
