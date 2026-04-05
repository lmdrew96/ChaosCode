import { useState, useRef, useCallback } from 'react'
import { extractCompletedFiles, parseReview } from '@/services/agenticParser'
import type { FileNode, Message, OpenFile, ReviewEntry } from '@/types'

function buildFileTreeText(nodes: FileNode[], depth = 0): string {
  return nodes
    .map((n) => {
      const indent = '  '.repeat(depth)
      if (n.type === 'directory') {
        const children = n.children ? buildFileTreeText(n.children, depth + 1) : ''
        return `${indent}${n.name}/\n${children}`
      }
      return `${indent}${n.name}`
    })
    .join('\n')
}

function uid() {
  return Math.random().toString(36).slice(2)
}

export type AgenticPhase =
  | 'idle'
  | 'planning'
  | 'implementing'
  | 'reviewing'
  | 'done'
  | 'interrupted'

export interface AgenticState {
  phase: AgenticPhase
  currentFilePath: string | null
  filesWritten: string[]
  filesReviewed: number
}

export interface BreakingIssue {
  filePath: string
  issues: string[]
}

interface Options {
  rootPath: string | null
  fileTree: FileNode[]
  openFile: OpenFile | null
  setMessages: React.Dispatch<React.SetStateAction<Message[]>>
  setReviews: React.Dispatch<React.SetStateAction<ReviewEntry[]>>
  onFileWritten: (filePath: string) => void
}

export function useAgenticMode({
  rootPath,
  fileTree,
  openFile,
  setMessages,
  setReviews,
  onFileWritten,
}: Options) {
  const [agenticState, setAgenticState] = useState<AgenticState>({
    phase: 'idle',
    currentFilePath: null,
    filesWritten: [],
    filesReviewed: 0,
  })
  const [breakingIssue, setBreakingIssue] = useState<BreakingIssue | null>(null)

  // Interrupt flag — Claude sets it, Gemini parsing loop checks it
  const interruptRef = useRef(false)
  // Track pending Claude review promises so we can await them all at the end
  const reviewPromises = useRef<Promise<void>[]>([])

  const dismissInterrupt = useCallback(() => {
    setBreakingIssue(null)
    setAgenticState((s) => ({ ...s, phase: 'idle' }))
    interruptRef.current = false
  }, [])

  /**
   * Runs a single Claude review for one file in the background.
   * Updates the review log. If breaking, sets the interrupt flag.
   */
  async function reviewFile(
    filePath: string,
    content: string,
    userTask: string
  ): Promise<void> {
    try {
      const reviewText = await window.api.claudeAgenticReview({ filePath, content, userTask })
      const result = parseReview(reviewText)

      if (result.severity === 'none') return

      const entry: ReviewEntry = {
        id: uid(),
        severity: result.severity,
        description: `${filePath}: ${result.issues.join('; ')}`,
        timestamp: Date.now(),
      }
      setReviews((prev) => [...prev, entry])

      if (result.severity === 'breaking') {
        interruptRef.current = true
        setBreakingIssue({ filePath, issues: result.issues })
        setAgenticState((s) => ({ ...s, phase: 'interrupted' }))

        // If Claude provided a fix for the breaking issue, write it
        if (result.fixedContent) {
          const absPath = `${rootPath}/${filePath}`
          await window.api.writeFile(absPath, result.fixedContent)
        }
        return
      }

      // Minor fix — write corrected content silently
      if (result.severity === 'minor' && result.fixedContent) {
        const absPath = `${rootPath}/${filePath}`
        await window.api.writeFile(absPath, result.fixedContent)
        onFileWritten(filePath)
      }

      setAgenticState((s) => ({ ...s, filesReviewed: s.filesReviewed + 1 }))
    } catch (err) {
      // Review errors are non-fatal — log but don't interrupt
      console.error('Claude review error:', err)
    }
  }

  /**
   * Main agentic entry point. Streams Gemini, parses files, fires reviews in parallel.
   */
  const runAgenticTask = useCallback(
    async (userTask: string) => {
      if (!rootPath) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            source: 'claude',
            content: '[ChaosCode] Open a folder first — agentic mode needs a root to write files into.',
            timestamp: Date.now(),
          },
        ])
        return
      }

      interruptRef.current = false
      reviewPromises.current = []
      setBreakingIssue(null)
      setAgenticState({
        phase: 'planning',
        currentFilePath: null,
        filesWritten: [],
        filesReviewed: 0,
      })

      // Show user message
      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: `[Agentic] ${userTask}`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Build project context so Gemini knows what already exists
      const treeText = fileTree.length > 0
        ? `Existing project files:\n${buildFileTreeText(fileTree)}`
        : 'No files in project yet.'

      const openFileContext = openFile
        ? `\n\nCurrently open file: \`${openFile.path}\`\n\`\`\`${openFile.language}\n${openFile.content}\n\`\`\``
        : ''

      const fullTask = `${treeText}${openFileContext}\n\n---\nTask: ${userTask}`

      // Create Gemini streaming message placeholder
      const geminiMsgId = uid()
      setMessages((prev) => [
        ...prev,
        { id: geminiMsgId, role: 'assistant', source: 'gemini', content: '', timestamp: Date.now() },
      ])
      setAgenticState((s) => ({ ...s, phase: 'implementing' }))

      // Accumulate stream
      let buffer = ''
      let processedUpTo = 0

      window.api.removeAllListeners('llm:gemini:token')

      window.api.onGeminiToken((token) => {
        buffer += token
        setMessages((prev) =>
          prev.map((m) => (m.id === geminiMsgId ? { ...m, content: buffer } : m))
        )

        // Check for newly completed file blocks
        if (!interruptRef.current) {
          const slice = buffer.slice(processedUpTo)
          const { files, consumed } = extractCompletedFiles(slice)

          if (files.length > 0) {
            processedUpTo += consumed

            for (const file of files) {
              if (interruptRef.current) break

              const absPath = `${rootPath}/${file.path}`
              setAgenticState((s) => ({
                ...s,
                currentFilePath: file.path,
                filesWritten: [...s.filesWritten, file.path],
              }))

              // Write file (fire-and-forget, then notify)
              window.api
                .writeFile(absPath, file.content)
                .then(() => onFileWritten(file.path))
                .catch(console.error)

              // Start Claude review in parallel — do NOT await
              const reviewPromise = reviewFile(file.path, file.content, userTask)
              reviewPromises.current.push(reviewPromise)
            }
          }
        }
      })

      // Kick off Gemini agentic call (uses structured output system prompt + file context)
      await window.api
        .sendToGeminiAgentic(fullTask)
        .catch((err) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === geminiMsgId ? { ...m, content: `[Error: ${err.message}]` } : m
            )
          )
        })

      // Post-stream full scan — catches any file blocks the incremental check may have missed
      // (can happen if the last token contained the closing </file> tag)
      if (!interruptRef.current) {
        const { files: remaining } = extractCompletedFiles(buffer.slice(processedUpTo))
        for (const file of remaining) {
          if (interruptRef.current) break
          const absPath = `${rootPath}/${file.path}`
          setAgenticState((s) => ({
            ...s,
            filesWritten: s.filesWritten.includes(file.path)
              ? s.filesWritten
              : [...s.filesWritten, file.path],
          }))
          window.api.writeFile(absPath, file.content).then(() => onFileWritten(file.path)).catch(console.error)
          reviewPromises.current.push(reviewFile(file.path, file.content, userTask))
        }
      }

      // Wait for all Claude reviews to settle
      if (!interruptRef.current) {
        setAgenticState((s) => ({ ...s, phase: 'reviewing', currentFilePath: null }))
        await Promise.allSettled(reviewPromises.current)
      }

      if (!interruptRef.current) {
        setAgenticState((s) => ({ ...s, phase: 'done', currentFilePath: null }))
      }
    },
    [rootPath, fileTree, openFile, setMessages, setReviews, onFileWritten]
  )

  return {
    agenticState,
    breakingIssue,
    dismissInterrupt,
    runAgenticTask,
  }
}
