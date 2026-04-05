import { useState, useRef, useCallback } from 'react'
import { extractCompletedFiles, parseReview } from '@/services/agenticParser'
import { formatValidationSummary, validateAgenticOutput } from '@/services/agenticSecurity'
import type { FileDiffSummary, FileNode, Message, OpenFile, ReviewEntry } from '@/types'

function toLines(text: string): string[] {
  if (!text) return []
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')
}

function lcsLength(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0

  const prev = new Uint32Array(b.length + 1)
  for (let i = 1; i <= a.length; i++) {
    let diag = 0
    for (let j = 1; j <= b.length; j++) {
      const temp = prev[j]
      prev[j] = a[i - 1] === b[j - 1]
        ? diag + 1
        : Math.max(prev[j], prev[j - 1])
      diag = temp
    }
  }
  return prev[b.length]
}

function countLineDiff(before: string, after: string): FileDiffSummary {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)
  const shared = lcsLength(beforeLines, afterLines)

  return {
    added: afterLines.length - shared,
    removed: beforeLines.length - shared,
  }
}

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
  reviewingFiles: string[]
  fileDiffs: Record<string, FileDiffSummary>
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
    reviewingFiles: [],
    fileDiffs: {},
  })
  const [breakingIssue, setBreakingIssue] = useState<BreakingIssue | null>(null)

  // Interrupt flag — Sonnet sets it, Haiku parsing loop checks it
  const interruptRef = useRef(false)
  // Active Haiku agentic request ID for immediate interrupt cancellation
  const activeAgenticRequestId = useRef<string | null>(null)
  // Track pending Sonnet review promises so we can await them all at the end
  const reviewPromises = useRef<Promise<void>[]>([])
  const originalContents = useRef<Record<string, string>>({})

  async function ensureOriginalContent(absPath: string): Promise<string> {
    const cached = originalContents.current[absPath]
    if (cached !== undefined) return cached

    try {
      const content = await window.api.readFile(absPath)
      originalContents.current[absPath] = content
      return content
    } catch {
      originalContents.current[absPath] = ''
      return ''
    }
  }

  async function persistFile(filePath: string, content: string): Promise<void> {
    if (!rootPath) throw new Error('Missing root path for agentic write')

    const validation = validateAgenticOutput({ rootPath, filePath, content })
    if (!validation.isValid) {
      const summary = formatValidationSummary(validation)
      interruptRef.current = true
      if (activeAgenticRequestId.current) {
        await window.api.cancelRequest(activeAgenticRequestId.current)
      }
      setBreakingIssue({ filePath, issues: validation.reasons })
      setAgenticState((s) => ({ ...s, phase: 'interrupted' }))
      setReviews((prev) => [...prev, {
        id: uid(),
        severity: 'breaking',
        description: summary,
        timestamp: Date.now(),
      }])
      setMessages((prev) => [...prev, {
        id: uid(),
        role: 'assistant',
        source: 'sonnet',
        content: `[Security] ${summary}`,
        timestamp: Date.now(),
      }])
      throw new Error(summary)
    }

    if (validation.warnings.length > 0) {
      setReviews((prev) => [...prev, {
        id: uid(),
        severity: 'minor',
        description: formatValidationSummary(validation),
        timestamp: Date.now(),
      }])
    }

    const absPath = `${rootPath}/${validation.normalizedPath}`
    const original = await ensureOriginalContent(absPath)
    await window.api.writeFile(absPath, content)
    const diff = countLineDiff(original, content)

    setAgenticState((s) => ({
      ...s,
      fileDiffs: {
        ...s.fileDiffs,
        [absPath]: diff,
      },
    }))
  }

  const dismissInterrupt = useCallback(() => {
    setBreakingIssue(null)
    setAgenticState((s) => ({ ...s, phase: 'idle' }))
    interruptRef.current = false
  }, [])

  /**
   * Runs a single Sonnet review for one file in the background.
   * Updates the review log. If breaking, sets the interrupt flag.
   */
  async function reviewFile(
    filePath: string,
    content: string,
    userTask: string
  ): Promise<void> {
    setAgenticState((s) => (
      s.reviewingFiles.includes(filePath)
        ? s
        : { ...s, reviewingFiles: [...s.reviewingFiles, filePath] }
    ))

    try {
      const reviewText = await window.api.sonnetAgenticReview({ filePath, content, userTask })
      let result = parseReview(reviewText)

      // Sonnet should fix, not only critique. If it reports issues without a patch,
      // request one strict retry that must include full corrected file content.
      if (result.severity !== 'none' && !result.fixedContent) {
        const retryTask = `${userTask}\n\nIMPORTANT: You previously found ${result.severity} issues in ${filePath} but did not provide a fix. Return a complete corrected file in <fixed>.`
        const retryText = await window.api.sonnetAgenticReview({ filePath, content, userTask: retryTask })
        const retryResult = parseReview(retryText)

        result = {
          severity: result.severity,
          issues: retryResult.issues.length > 0 ? retryResult.issues : result.issues,
          fixedContent: retryResult.fixedContent ?? result.fixedContent,
        }
      }

      if (result.severity === 'none') return

      const hasPatch = Boolean(result.fixedContent)
      const entry: ReviewEntry = {
        id: uid(),
        severity: result.severity,
        description: `${filePath}: ${result.issues.join('; ')}${hasPatch ? ' (auto-fixed)' : ' (no patch returned)'}`,
        timestamp: Date.now(),
      }
      setReviews((prev) => [...prev, entry])

      if (result.severity === 'breaking') {
        interruptRef.current = true
        if (activeAgenticRequestId.current) {
          await window.api.cancelRequest(activeAgenticRequestId.current)
        }
        setBreakingIssue({ filePath, issues: result.issues })
        setAgenticState((s) => ({ ...s, phase: 'interrupted' }))

        // If Sonnet provided a fix for the breaking issue, write it
        if (result.fixedContent) {
          await persistFile(filePath, result.fixedContent)
        }
        return
      }

      // Minor fix — write corrected content silently
      if (result.severity === 'minor' && result.fixedContent) {
        await persistFile(filePath, result.fixedContent)
        onFileWritten(filePath)
      }

      setAgenticState((s) => ({ ...s, filesReviewed: s.filesReviewed + 1 }))
    } catch (err) {
      // Review errors are non-fatal — log but don't interrupt
      console.error('Sonnet review error:', err)
    } finally {
      setAgenticState((s) => ({
        ...s,
        reviewingFiles: s.reviewingFiles.filter((path) => path !== filePath),
      }))
    }
  }

  /**
    * Main agentic entry point. Streams Haiku, parses files, fires reviews in parallel.
   */
  const runAgenticTask = useCallback(
    async (userTask: string) => {
      if (!rootPath) {
        setMessages((prev) => [
          ...prev,
          {
            id: uid(),
            role: 'assistant',
            source: 'sonnet',
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
        reviewingFiles: [],
        fileDiffs: {},
      })
      originalContents.current = {}

      // Show user message
      const userMsg: Message = {
        id: uid(),
        role: 'user',
        content: `[Agentic] ${userTask}`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, userMsg])

      // Build project context so Haiku knows what already exists
      const treeText = fileTree.length > 0
        ? buildFileTreeText(fileTree)
        : 'No files in project yet.'

      const openFileContext = openFile
        ? [
            '<active_file>',
            `<path>${openFile.path}</path>`,
            `<language>${openFile.language}</language>`,
            '<content>',
            openFile.content,
            '</content>',
            '</active_file>',
          ].join('\n')
        : '<active_file />'

      const fullTask = [
        '<agentic_task_input>',
        '<project_tree>',
        treeText,
        '</project_tree>',
        openFileContext,
        '<task>',
        userTask,
        '</task>',
        '</agentic_task_input>',
      ].join('\n\n')
      const requestId = uid()
      activeAgenticRequestId.current = requestId

      // Create Haiku streaming message placeholder
      const haikuMsgId = uid()
      setMessages((prev) => [
        ...prev,
        { id: haikuMsgId, role: 'assistant', source: 'haiku', content: '', timestamp: Date.now() },
      ])
      setAgenticState((s) => ({ ...s, phase: 'implementing' }))

      // Accumulate stream
      let buffer = ''
      let processedUpTo = 0

      const unsubscribeToken = window.api.onHaikuAgenticToken(requestId, (token) => {
        buffer += token
        setMessages((prev) =>
          prev.map((m) => (m.id === haikuMsgId ? { ...m, content: buffer } : m))
        )

        // Check for newly completed file blocks
        if (!interruptRef.current) {
          const slice = buffer.slice(processedUpTo)
          const { files, consumed } = extractCompletedFiles(slice)

          if (files.length > 0) {
            processedUpTo += consumed

            for (const file of files) {
              if (interruptRef.current) break

              setAgenticState((s) => ({
                ...s,
                currentFilePath: file.path,
                filesWritten: [...s.filesWritten, file.path],
              }))

              // Write file (fire-and-forget, then notify)
              persistFile(file.path, file.content)
                .then(() => onFileWritten(file.path))
                .catch(console.error)

              // Start Sonnet review in parallel — do NOT await
              const reviewPromise = reviewFile(file.path, file.content, userTask)
              reviewPromises.current.push(reviewPromise)
            }
          }
        }
      })

      const unsubscribeDone = window.api.onHaikuAgenticDone(requestId, () => {
        // no-op; handler exists to keep listener lifecycle explicit and disposable
      })

      // Kick off Haiku agentic call (uses structured output system prompt + file context)
      try {
        await window.api.sendToHaikuAgentic(fullTask, requestId)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setMessages((prev) =>
          prev.map((m) =>
            m.id === haikuMsgId ? { ...m, content: `[Error: ${message}]` } : m
          )
        )
      } finally {
        unsubscribeToken()
        unsubscribeDone()
        activeAgenticRequestId.current = null
      }

      // Post-stream full scan — catches any file blocks the incremental check may have missed
      // (can happen if the last token contained the closing </file> tag)
      if (!interruptRef.current) {
        const { files: remaining } = extractCompletedFiles(buffer.slice(processedUpTo))
        for (const file of remaining) {
          if (interruptRef.current) break
          setAgenticState((s) => ({
            ...s,
            filesWritten: s.filesWritten.includes(file.path)
              ? s.filesWritten
              : [...s.filesWritten, file.path],
          }))
          persistFile(file.path, file.content).then(() => onFileWritten(file.path)).catch(console.error)
          reviewPromises.current.push(reviewFile(file.path, file.content, userTask))
        }
      }

      // Wait for all Sonnet reviews to settle
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
