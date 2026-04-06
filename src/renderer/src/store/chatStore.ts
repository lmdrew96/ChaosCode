import { create } from 'zustand'
import type { Message, ReviewEntry, LLMTarget } from '@/types'
import { contentToString } from '@/types'

const PREFS_KEY = 'chaoscode.preferences'

interface Prefs {
  autoApprove?: boolean
  haikuModel?: string
  sonnetModel?: string
}

function readPrefs(): Prefs {
  try { return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') } catch { return {} }
}

function writePrefs(patch: Partial<Prefs>): void {
  localStorage.setItem(PREFS_KEY, JSON.stringify({ ...readPrefs(), ...patch }))
}

// ≈4 chars per token (rough but consistent approximation for cost visibility)
function estimateTokens(messages: Message[]): number {
  if (!messages?.length) return 0
  const chars = messages.reduce((sum, m) => {
    try { return sum + contentToString(m.content).length } catch { return sum }
  }, 0)
  return Math.ceil(chars / 4)
}

interface ChatStore {
  messages: Message[]
  reviews: ReviewEntry[]
  target: LLMTarget
  agenticMode: boolean
  autoApprove: boolean
  haikuStreaming: boolean
  sonnetStreaming: boolean
  /** Estimated token count across all messages in the current session */
  estimatedTokens: number
  /** Active model IDs for each role — overridable by the user */
  haikuModel: string
  sonnetModel: string

  // Dispatch-compatible setters (accept value or functional updater — mirrors React.SetStateAction)
  setMessages: (value: Message[] | ((prev: Message[]) => Message[])) => void
  setReviews: (value: ReviewEntry[] | ((prev: ReviewEntry[]) => ReviewEntry[])) => void
  setTarget: (t: LLMTarget) => void
  setAgenticMode: (v: boolean) => void
  setAutoApprove: (v: boolean) => void
  setHaikuStreaming: (v: boolean) => void
  setSonnetStreaming: (v: boolean) => void
  setHaikuModel: (id: string) => void
  setSonnetModel: (id: string) => void
}

const useChatStore = create<ChatStore>((set) => {
  const prefs = readPrefs()
  return {
  messages: [],
  reviews: [],
  target: 'both',
  agenticMode: false,
  autoApprove: prefs.autoApprove ?? false,
  haikuStreaming: false,
  sonnetStreaming: false,
  estimatedTokens: 0,
  haikuModel: prefs.haikuModel ?? 'claude-haiku-4-5',
  sonnetModel: prefs.sonnetModel ?? 'claude-sonnet-4-6',

  setMessages: (value) =>
    set((state) => {
      const messages = typeof value === 'function' ? value(state.messages) : (value ?? [])
      return { messages, estimatedTokens: estimateTokens(messages) }
    }),

  setReviews: (value) =>
    set((state) => ({
      reviews: typeof value === 'function' ? value(state.reviews) : value,
    })),

  setTarget: (target) => set({ target }),
  setAgenticMode: (agenticMode) => set({ agenticMode }),
  setAutoApprove: (autoApprove) => { writePrefs({ autoApprove }); set({ autoApprove }) },
  setHaikuStreaming: (haikuStreaming) => set({ haikuStreaming }),
  setSonnetStreaming: (sonnetStreaming) => set({ sonnetStreaming }),
  setHaikuModel: (haikuModel) => { writePrefs({ haikuModel }); set({ haikuModel }) },
  setSonnetModel: (sonnetModel) => { writePrefs({ sonnetModel }); set({ sonnetModel }) },
  }
})

export default useChatStore
