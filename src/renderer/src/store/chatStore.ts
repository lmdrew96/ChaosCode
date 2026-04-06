import { create } from 'zustand'
import type { Message, ReviewEntry, LLMTarget } from '@/types'
import { contentToString } from '@/types'

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

const useChatStore = create<ChatStore>((set) => ({
  messages: [],
  reviews: [],
  target: 'both',
  agenticMode: false,
  autoApprove: false,
  haikuStreaming: false,
  sonnetStreaming: false,
  estimatedTokens: 0,
  haikuModel: 'claude-haiku-4-5',
  sonnetModel: 'claude-sonnet-4-6',

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
  setAutoApprove: (autoApprove) => set({ autoApprove }),
  setHaikuStreaming: (haikuStreaming) => set({ haikuStreaming }),
  setSonnetStreaming: (sonnetStreaming) => set({ sonnetStreaming }),
  setHaikuModel: (haikuModel) => set({ haikuModel }),
  setSonnetModel: (sonnetModel) => set({ sonnetModel }),
}))

export default useChatStore
