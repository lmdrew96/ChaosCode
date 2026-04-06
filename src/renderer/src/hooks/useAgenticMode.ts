import { useState, useRef, useCallback } from 'react'
import { parsePlan, parseReview, parseStreamToolCalls } from '@/services/agenticParser'
import { scheduleToolCalls } from '@/services/agenticExecutionLoop'
import { formatValidationSummary, validateAgenticOutput } from '@/services/agenticSecurity'
import { countLineDiff } from '@/services/lineDiff'
import { ToolRegistry } from '@/services/toolRegistry'
import type { AgenticPlan, FileDiffSummary, FileNode, Message, MessagePart, OpenFile, ReviewEntry, TerminalOutputPart } from '@/types'
import useChatStore from '@/store/chatStore'


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
  | 'plan-review'
  | 'awaiting-approval'
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
  plan: AgenticPlan | null
}

export interface BreakingIssue {
  filePath: string
  issues: string[]
}

interface Options {
  rootPath: string | null
  fileTree: FileNode[]
  openFile: OpenFile | null
  onFileWritten: (filePath: string) => void | Promise<void>
}

export function useAgenticMode({
  rootPath,
  fileTree,
  openFile,
  onFileWritten,
}: Options) {
  const { setMessages, setReviews, haikuModel, sonnetModel, autoApprove } = useChatStore()
  const [agenticState, setAgenticState] = useState<AgenticState>({
    phase: 'idle',
    currentFilePath: null,
    filesWritten: [],
    filesReviewed: 0,
    reviewingFiles: [],
    fileDiffs: {},
    plan: null,
  })
  const [breakingIssue, setBreakingIssue] = useState<BreakingIssue | null>(null)

  // Guard against concurrent agentic runs
  const isRunningRef = useRef(false)
  // Interrupt flag — Sonnet sets it, Haiku parsing loop checks it
  const interruptRef = useRef(false)
  // Active Haiku agentic request ID for immediate interrupt cancellation
  const activeAgenticRequestId = useRef<string | null>(null)
  // Track pending Sonnet review promises so we can await them all at the end
  const reviewPromises = useRef<Promise<void>[]>([])
  const originalContents = useRef<Record<string, string>>({})
  // Serialize operations per file path to avoid write/review races on the same file
  const fileOperationQueues = useRef<Record<string, Promise<void>>>({})
  // Avoid processing the same streamed file block multiple times (incremental + post-scan)
  const lastQueuedContentByFile = useRef<Record<string, string>>({})
  // Resolve function set when phase === 'awaiting-approval'; calling it proceeds to implementation
  const approvalResolveRef = useRef<(() => void) | null>(null)

  function queueFileOperation(filePath: string, op: () => Promise<void>): Promise<void> {
    const prev = fileOperationQueues.current[filePath] ?? Promise.resolve()
    const next = prev
      .catch(() => {
        // Keep queue moving even if previous operation failed.
      })
      .then(op)

    fileOperationQueues.current[filePath] = next.finally(() => {
      if (fileOperationQueues.current[filePath] === next) {
        delete fileOperationQueues.current[filePath]
      }
    })

    return next
  }

  function appendMessagePart(messageId: string, part: MessagePart): void {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m
        const parts = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as MessagePart] : [...m.content]
        return { ...m, content: [...parts, part] }
      })
    )
  }

  function appendTextToMessage(messageId: string, token: string): void {
    setMessages((prev) =>
      prev.map((m) => {
        if (m.id !== messageId) return m
        if (typeof m.content === 'string') {
          return { ...m, content: m.content + token }
        }

        const parts = [...m.content]
        const last = parts[parts.length - 1]
        if (!last || last.type !== 'text') {
          parts.push({ type: 'text', text: token })
          return { ...m, content: parts }
        }

        parts[parts.length - 1] = { ...last, text: last.text + token }
        return { ...m, content: parts }
      })
    )
  }

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

  const cancelAgenticTask = useCallback(async () => {
    interruptRef.current = true
    // Unblock the approval await so runAgenticTask can see interruptRef and exit
    const resolveApproval = approvalResolveRef.current
    approvalResolveRef.current = null
    resolveApproval?.()

    const requestId = activeAgenticRequestId.current
    if (requestId) {
      try {
        await window.api.cancelRequest(requestId)
      } catch (err) {
        console.error('Failed to cancel active agentic request:', err)
      }
    }
    activeAgenticRequestId.current = null
    setAgenticState((s) => {
      if (s.phase === 'idle' || s.phase === 'done' || s.phase === 'interrupted') return s
      return { ...s, phase: 'interrupted', currentFilePath: null }
    })
  }, [])

  const approvePlan = useCallback(() => {
    approvalResolveRef.current?.()
    approvalResolveRef.current = null
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
      const reviewText = await window.api.sonnetAgenticReview({ filePath, content, userTask, model: sonnetModel })
      let result = parseReview(reviewText)

      // Sonnet should fix, not only critique. If it reports issues without a patch,
      // request one strict retry that must include full corrected file content.
      if (result.severity !== 'none' && !result.fixedContent) {
        const retryTask = `${userTask}\n\nIMPORTANT: You previously found ${result.severity} issues in ${filePath} but did not provide a fix. Return a complete corrected file in <fixed>.`
        const retryText = await window.api.sonnetAgenticReview({ filePath, content, userTask: retryTask, model: sonnetModel })
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
          await onFileWritten(filePath)
        }
        return
      }

      // Minor fix — write corrected content silently
      if (result.severity === 'minor' && result.fixedContent) {
        await persistFile(filePath, result.fixedContent)
        await onFileWritten(filePath)
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
   * Main agentic entry point.
   * Stages: planning → plan-review → (awaiting-approval) → implementing → reviewing
   */
  const runAgenticTask = useCallback(
    async (userTask: string, chatCarryover = '') => {
      if (isRunningRef.current) return
      isRunningRef.current = true

      try {
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
      approvalResolveRef.current = null
      reviewPromises.current = []
      setBreakingIssue(null)
      lastQueuedContentByFile.current = {}
      setAgenticState({
        phase: 'planning',
        currentFilePath: null,
        filesWritten: [],
        filesReviewed: 0,
        reviewingFiles: [],
        fileDiffs: {},
        plan: null,
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

      // Build project context (shared by planning + implementation calls)
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

      const escapedTask = userTask.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      const contextBlock = [
        '<agentic_task_input>',
        chatCarryover ? `<chat_carryover>\n${chatCarryover}\n</chat_carryover>` : '',
        '<project_tree>',
        treeText,
        '</project_tree>',
        openFileContext,
        '<task>',
        escapedTask,
        '</task>',
        '</agentic_task_input>',
      ].filter(Boolean).join('\n\n')

      // ── Stage 1: Haiku planning ──────────────────────────────────────────────

      const planRequestId = uid()
      activeAgenticRequestId.current = planRequestId

      const haikuPlanMsgId = uid()
      setMessages((prev) => [
        ...prev,
        {
          id: haikuPlanMsgId,
          role: 'assistant',
          source: 'haiku',
          content: [{ type: 'text', text: '' }],
          timestamp: Date.now(),
        },
      ])

      let planText = ''
      const unsubscribePlanToken = window.api.onHaikuPlanToken(planRequestId, (token) => {
        planText += token
        appendTextToMessage(haikuPlanMsgId, token)
      })
      const unsubscribePlanDone = window.api.onHaikuPlanDone(planRequestId, () => {})

      try {
        await window.api.sendToHaikuPlan(contextBlock, planRequestId, haikuModel)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        setMessages((prev) =>
          prev.map((m) => m.id === haikuPlanMsgId ? { ...m, content: `[Error: ${message}]` } : m)
        )
        setAgenticState((s) => ({ ...s, phase: 'interrupted' }))
        return
      } finally {
        unsubscribePlanToken()
        unsubscribePlanDone()
        activeAgenticRequestId.current = null
      }

      if (interruptRef.current) return

      // ── Stage 2: Sonnet plan review ──────────────────────────────────────────

      setAgenticState((s) => ({ ...s, phase: 'plan-review' }))

      let reviewedPlanText = planText
      try {
        const sonnetReviewedPlan = await window.api.sonnetPlanReview({
          userTask,
          planText,
          model: sonnetModel,
        })
        if (sonnetReviewedPlan.trim()) reviewedPlanText = sonnetReviewedPlan
      } catch (err) {
        console.error('Plan review error:', err)
        // Non-fatal: proceed with Haiku's original plan
      }

      if (interruptRef.current) return

      const parsedPlan = parsePlan(reviewedPlanText)

      // Show Sonnet's reviewed plan as a message
      setMessages((prev) => [
        ...prev,
        {
          id: uid(),
          role: 'assistant',
          source: 'sonnet',
          content: reviewedPlanText,
          timestamp: Date.now(),
        },
      ])

      setAgenticState((s) => ({
        ...s,
        plan: parsedPlan ?? s.plan,
        phase: autoApprove ? 'implementing' : 'awaiting-approval',
      }))

      // ── Stage 3: User approval (skipped when autoApprove is on) ─────────────

      if (!autoApprove) {
        await new Promise<void>((resolve) => {
          approvalResolveRef.current = resolve
        })
        if (interruptRef.current) return
        setAgenticState((s) => ({ ...s, phase: 'implementing' }))
      }

      // ── Stage 4: Haiku implementation ────────────────────────────────────────

      const fullTask = [
        contextBlock,
        `<approved_plan>\n${reviewedPlanText}\n</approved_plan>`,
      ].join('\n\n')

      const requestId = uid()
      activeAgenticRequestId.current = requestId

      // Create Haiku streaming message placeholder
      const haikuMsgId = uid()
      setMessages((prev) => [
        ...prev,
        {
          id: haikuMsgId,
          role: 'assistant',
          source: 'haiku',
          content: [{ type: 'text', text: '' }],
          timestamp: Date.now(),
        },
      ])

      const registry = new ToolRegistry()
      registry.register({
        name: 'persist_and_review',
        description: 'Persist a file and run Sonnet review on it',
        execute: async (input) => {
          const filePath = typeof input.path === 'string' ? input.path : ''
          const content = typeof input.content === 'string' ? input.content : ''
          if (!filePath || !content) {
            return {
              success: false,
              content: 'persist_and_review requires string fields: path and content',
            }
          }

          await queueFileOperation(filePath, async () => {
            await persistFile(filePath, content)
            await onFileWritten(filePath)
            await reviewFile(filePath, content, userTask)
          })

          return {
            success: true,
            content: `Wrote and reviewed ${filePath}`,
          }
        },
      })

      registry.register({
        name: 'run_terminal_command',
        description: 'Execute a shell command within the project root and return stdout/stderr. The optional cwd field is a path relative to the project root.',
        execute: async (input) => {
          const command = typeof input.command === 'string' ? input.command : ''
          const cwd = typeof input.cwd === 'string' ? input.cwd : undefined

          if (!command) return { success: false, content: 'run_terminal_command: missing command' }
          if (!rootPath) return { success: false, content: 'run_terminal_command: no project folder is open' }

          const result = await window.api.runCommand(command, cwd, rootPath)

          const termPart: TerminalOutputPart = {
            type: 'terminal_output',
            terminalOutput: { command, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode },
          }
          appendMessagePart(haikuMsgId, termPart)

          const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim()
          return {
            success: result.exitCode === 0,
            content: output || `Exit code: ${result.exitCode}`,
          }
        },
      })

      // Accumulate stream
      let buffer = ''
      let processedUpTo = 0

      const scheduleParsedCalls = (calls: ReturnType<typeof parseStreamToolCalls>['calls']) => {
        const freshCalls = calls.filter((call) => {
          if (call.name !== 'persist_and_review') return true
          const filePath = typeof call.input.path === 'string' ? call.input.path : null
          const content = typeof call.input.content === 'string' ? call.input.content : null
          if (!filePath || content === null) return true

          if (lastQueuedContentByFile.current[filePath] === content) {
            return false
          }

          lastQueuedContentByFile.current[filePath] = content
          return true
        })

        if (freshCalls.length === 0) return

        const scheduled = scheduleToolCalls({
          calls: freshCalls,
          registry,
          onToolUse: (call) => {
            const safeInput = call.name === 'persist_and_review'
              ? { path: typeof call.input.path === 'string' ? call.input.path : '' }
              : call.input

            appendMessagePart(haikuMsgId, {
              type: 'tool_use',
              toolUse: {
                id: call.id,
                name: call.name,
                input: safeInput,
              },
            })

            if (call.name === 'persist_and_review' && typeof call.input.path === 'string') {
              const filePath = call.input.path
              setAgenticState((s) => ({
                ...s,
                currentFilePath: filePath,
                filesWritten: s.filesWritten.includes(filePath)
                  ? s.filesWritten
                  : [...s.filesWritten, filePath],
              }))
            }
          },
          onToolResult: (call, result) => {
            appendMessagePart(haikuMsgId, {
              type: 'tool_result',
              toolResult: {
                toolUseId: call.id,
                content: result.content,
                isError: !result.success,
              },
            })
          },
        })

        reviewPromises.current.push(...scheduled)
      }

      const unsubscribeToken = window.api.onHaikuAgenticToken(requestId, (token) => {
        buffer += token
        appendTextToMessage(haikuMsgId, token)

        // Check for newly completed tool blocks
        if (!interruptRef.current) {
          const slice = buffer.slice(processedUpTo)
          const parsed = parseStreamToolCalls(slice)
          if (parsed.calls.length > 0) {
            processedUpTo += parsed.consumed
            scheduleParsedCalls(parsed.calls)
          }
        }
      })

      const unsubscribeDone = window.api.onHaikuAgenticDone(requestId, () => {
        // no-op; handler exists to keep listener lifecycle explicit and disposable
      })

      // Kick off Haiku agentic call (uses structured output system prompt + file context)
      try {
        await window.api.sendToHaikuAgentic(fullTask, requestId, haikuModel)
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

      // Post-stream full scan — catches any tool blocks the incremental check may have missed.
      if (!interruptRef.current) {
        const parsedRemaining = parseStreamToolCalls(buffer.slice(processedUpTo))
        scheduleParsedCalls(parsedRemaining.calls)
      }

      // Wait for all Sonnet reviews to settle
      if (!interruptRef.current) {
        setAgenticState((s) => ({ ...s, phase: 'reviewing', currentFilePath: null }))
        await Promise.allSettled(reviewPromises.current)
      }

      if (!interruptRef.current) {
        setAgenticState((s) => ({ ...s, phase: 'done', currentFilePath: null }))
      }
      } finally {
        isRunningRef.current = false
      }
    },
    [rootPath, fileTree, openFile, setMessages, setReviews, onFileWritten, haikuModel, sonnetModel, autoApprove] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return {
    agenticState,
    breakingIssue,
    dismissInterrupt,
    cancelAgenticTask,
    approvePlan,
    runAgenticTask,
  }
}
