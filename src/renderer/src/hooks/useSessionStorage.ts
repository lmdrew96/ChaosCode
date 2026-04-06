import { useCallback, useRef, useState } from 'react'
import type { LLMTarget, Message, ReviewEntry } from '@/types'

const SESSIONS_KEY = 'chaoscode.sessions'
const ACTIVE_SESSION_KEY = 'chaoscode.activeSession'
const MAX_SESSIONS = 20
const SAVE_DEBOUNCE_MS = 1000

export interface StoredSession {
  id: string
  name: string
  updatedAt: number
  rootPath: string | null
  openFilePath: string | null
  pinnedFilePaths: string[]
  messages: Message[]
  reviews: ReviewEntry[]
  target: LLMTarget
  agenticMode: boolean
}

export interface SessionSnapshot {
  rootPath: string | null
  openFilePath: string | null
  pinnedFilePaths: string[]
  messages: Message[]
  reviews: ReviewEntry[]
  target: LLMTarget
  agenticMode: boolean
}

function uid(): string {
  return Math.random().toString(36).slice(2)
}

function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function makeSessionName(rootPath: string | null, createdAt: number): string {
  const folder = rootPath?.split('/').pop()
  return folder ? `${folder} · ${formatDate(createdAt)}` : `Session · ${formatDate(createdAt)}`
}

function makeEmptySession(): StoredSession {
  return {
    id: uid(),
    name: `Session · ${formatDate(Date.now())}`,
    updatedAt: Date.now(),
    rootPath: null,
    openFilePath: null,
    pinnedFilePaths: [],
    messages: [],
    reviews: [],
    target: 'both',
    agenticMode: false,
  }
}

function readSessions(): StoredSession[] {
  try {
    const raw = localStorage.getItem(SESSIONS_KEY)
    if (!raw) return []
    return JSON.parse(raw) as StoredSession[]
  } catch {
    return []
  }
}

function writeSessions(sessions: StoredSession[]): void {
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions))
}

function readActiveId(): string | null {
  return localStorage.getItem(ACTIVE_SESSION_KEY)
}

function writeActiveId(id: string): void {
  localStorage.setItem(ACTIVE_SESSION_KEY, id)
}

function getInitialState(): { sessions: StoredSession[]; activeSessionId: string } {
  let sessions = readSessions()

  if (sessions.length === 0) {
    const fresh = makeEmptySession()
    sessions = [fresh]
    writeSessions(sessions)
  }

  const storedId = readActiveId()
  const activeSessionId =
    storedId && sessions.find((s) => s.id === storedId) ? storedId : sessions[0].id

  writeActiveId(activeSessionId)
  return { sessions, activeSessionId }
}

export function useSessionStorage() {
  const initial = useRef(getInitialState())

  const [sessions, setSessions] = useState<StoredSession[]>(initial.current.sessions)
  const [activeSessionId, setActiveSessionId] = useState<string>(initial.current.activeSessionId)

  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const saveSession = useCallback((id: string, snapshot: SessionSnapshot) => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      setSessions((prev) => {
        const existing = prev.find((s) => s.id === id)
        const createdAt = existing?.updatedAt ?? Date.now()
        const updated: StoredSession = {
          id,
          name: makeSessionName(snapshot.rootPath, createdAt),
          updatedAt: Date.now(),
          ...snapshot,
        }
        let next = existing ? prev.map((s) => (s.id === id ? updated : s)) : [updated, ...prev]
        if (next.length > MAX_SESSIONS) next = next.slice(0, MAX_SESSIONS)
        writeSessions(next)
        return next
      })
    }, SAVE_DEBOUNCE_MS)
  }, [])

  const newSession = useCallback((): StoredSession => {
    const fresh = makeEmptySession()
    setSessions((prev) => {
      let next = [fresh, ...prev]
      if (next.length > MAX_SESSIONS) next = next.slice(0, MAX_SESSIONS)
      writeSessions(next)
      return next
    })
    setActiveSessionId(fresh.id)
    writeActiveId(fresh.id)
    return fresh
  }, [])

  const switchSession = useCallback(
    (id: string): StoredSession | null => {
      const target = sessions.find((s) => s.id === id) ?? null
      if (!target) return null
      setActiveSessionId(id)
      writeActiveId(id)
      return target
    },
    [sessions]
  )

  const deleteSession = useCallback((id: string): StoredSession | null => {
    // Read latest from localStorage (source of truth) to avoid stale closure
    const current = readSessions()
    const remaining = current.filter((s) => s.id !== id)

    if (remaining.length === 0) {
      const fresh = makeEmptySession()
      writeSessions([fresh])
      setSessions([fresh])
      setActiveSessionId(fresh.id)
      writeActiveId(fresh.id)
      return fresh
    }

    writeSessions(remaining)
    setSessions(remaining)

    const currentActiveId = localStorage.getItem(ACTIVE_SESSION_KEY)
    if (currentActiveId === id) {
      const next = remaining[0]
      setActiveSessionId(next.id)
      writeActiveId(next.id)
      return next
    }

    return null
  }, [])

  const activeSession = sessions.find((s) => s.id === activeSessionId) ?? null

  return {
    sessions,
    activeSessionId,
    activeSession,
    saveSession,
    newSession,
    switchSession,
    deleteSession,
  }
}
