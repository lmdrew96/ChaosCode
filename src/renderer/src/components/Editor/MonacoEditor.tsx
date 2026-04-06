import Editor, { useMonaco } from '@monaco-editor/react'
import { useEffect, useRef, useState } from 'react'
import * as Monaco from 'monaco-editor'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { vs } from 'react-syntax-highlighter/dist/esm/styles/prism'
import type { OpenFile } from '@/types'
import type { ColorScheme, ResolvedTheme } from '@/hooks/useTheme'

// Monaco defaults to a transient in-memory model URI unless we provide a stable
// path. Using the file path keeps the TypeScript worker from racing on
// `inmemory://model/1`; the unhandledrejection guard remains as a fallback.
if (typeof window !== 'undefined') {
  window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) => {
    if (e.reason?.message?.includes('inmemory://model/1')) {
      e.preventDefault()
    }
  })
}

// Inject diff decoration styles once at module load
const DIFF_STYLE_ID = 'chaoscode-diff-decorations'
if (typeof document !== 'undefined' && !document.getElementById(DIFF_STYLE_ID)) {
  const s = document.createElement('style')
  s.id = DIFF_STYLE_ID
  s.textContent = [
    '.cc-diff-added { background: rgba(34,197,94,0.07) !important; }',
    '.cc-diff-added-gutter { background: #22c55e; width: 3px !important; margin-left: 2px; border-radius: 1px; }',
  ].join('\n')
  document.head.appendChild(s)
}

interface Props {
  file: OpenFile | null
  onChange: (content: string) => void
  theme: ResolvedTheme
  colorScheme: ColorScheme
  /** 1-based line numbers changed by the last agentic write, for gutter highlighting */
  addedLines?: number[]
}

type ThemeKey = `${ColorScheme}-${ResolvedTheme}`

const MONACO_THEMES: Record<ThemeKey, Monaco.editor.IStandaloneThemeData> = {
  'slate-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8b949e', fontStyle: 'italic' },
      { token: 'keyword', foreground: '8ab4f8' },
      { token: 'string', foreground: 'f9b17a' },
      { token: 'number', foreground: 'c8e1a1' },
      { token: 'type', foreground: '79c0ff' },
    ],
    colors: {
      'editor.background': '#0f0f0f',
      'editor.foreground': '#f5f5f5',
      'editorLineNumber.foreground': '#52525b',
      'editorLineNumber.activeForeground': '#a1a1aa',
      'editor.lineHighlightBackground': '#1a1a1a',
      'editor.selectionBackground': '#264f78',
      'editorCursor.foreground': '#60a5fa',
      'editor.inactiveSelectionBackground': '#1e3a5f',
      'editorIndentGuide.background': '#2a2a2a',
      'editorIndentGuide.activeBackground': '#3a3a3a',
      'scrollbarSlider.background': '#38383880',
      'scrollbarSlider.hoverBackground': '#4a4a4a80',
      'scrollbar.shadow': '#00000000',
    },
  },
  'slate-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748b', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1d4ed8' },
      { token: 'string', foreground: 'b45309' },
      { token: 'number', foreground: '15803d' },
      { token: 'type', foreground: '0f766e' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#0f172a',
      'editorLineNumber.foreground': '#94a3b8',
      'editorLineNumber.activeForeground': '#475569',
      'editor.lineHighlightBackground': '#eef2ff',
      'editor.selectionBackground': '#bfdbfe',
      'editorCursor.foreground': '#2563eb',
      'editor.inactiveSelectionBackground': '#dbeafe',
      'editorIndentGuide.background': '#e2e8f0',
      'editorIndentGuide.activeBackground': '#cbd5e1',
      'scrollbarSlider.background': '#94a3b880',
      'scrollbarSlider.hoverBackground': '#64748b80',
      'scrollbar.shadow': '#00000000',
    },
  },
  'nord-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '4C566A', fontStyle: 'italic' },
      { token: 'keyword', foreground: '81A1C1' },
      { token: 'string', foreground: 'A3BE8C' },
      { token: 'number', foreground: 'B48EAD' },
      { token: 'type', foreground: '8FBCBB' },
    ],
    colors: {
      'editor.background': '#2E3440',
      'editor.foreground': '#D8DEE9',
      'editorLineNumber.foreground': '#4C566A',
      'editorLineNumber.activeForeground': '#D8DEE9',
      'editor.lineHighlightBackground': '#3B4252',
      'editor.selectionBackground': '#434C5E',
      'editorCursor.foreground': '#88C0D0',
      'editor.inactiveSelectionBackground': '#3B4252',
      'editorIndentGuide.background': '#3B4252',
      'editorIndentGuide.activeBackground': '#434C5E',
      'scrollbarSlider.background': '#4C566A80',
      'scrollbarSlider.hoverBackground': '#81A1C180',
      'scrollbar.shadow': '#00000000',
    },
  },
  'nord-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '9aacbd', fontStyle: 'italic' },
      { token: 'keyword', foreground: '5E81AC' },
      { token: 'string', foreground: '4C7A5C' },
      { token: 'number', foreground: '8A5E8A' },
      { token: 'type', foreground: '407E8A' },
    ],
    colors: {
      'editor.background': '#ECEFF4',
      'editor.foreground': '#2E3440',
      'editorLineNumber.foreground': '#788898',
      'editorLineNumber.activeForeground': '#3B4252',
      'editor.lineHighlightBackground': '#D8DEE9',
      'editor.selectionBackground': '#81A1C140',
      'editorCursor.foreground': '#5E81AC',
      'editor.inactiveSelectionBackground': '#C8D4E0',
      'editorIndentGuide.background': '#C8D4E0',
      'editorIndentGuide.activeBackground': '#B0BECE',
      'scrollbarSlider.background': '#9aacbd80',
      'scrollbarSlider.hoverBackground': '#5E81AC80',
      'scrollbar.shadow': '#00000000',
    },
  },
  'adhd-dark': {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6a5a88', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'DBD5E2' },
      { token: 'string', foreground: 'DEA649' },
      { token: 'number', foreground: '97D181' },
      { token: 'type', foreground: '8CBDB9' },
    ],
    colors: {
      'editor.background': '#1E1830',
      'editor.foreground': '#f0ecf8',
      'editorLineNumber.foreground': '#4a4268',
      'editorLineNumber.activeForeground': '#b0a8d8',
      'editor.lineHighlightBackground': '#261e3c',
      'editor.selectionBackground': '#4a3a70',
      'editorCursor.foreground': '#88739E',
      'editor.inactiveSelectionBackground': '#302448',
      'editorIndentGuide.background': '#302848',
      'editorIndentGuide.activeBackground': '#4a3a70',
      'scrollbarSlider.background': '#4a426880',
      'scrollbarSlider.hoverBackground': '#88739E80',
      'scrollbar.shadow': '#00000000',
    },
  },
  'adhd-light': {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a898c8', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1E1830' },
      { token: 'string', foreground: 'b87820' },
      { token: 'number', foreground: '4a8a3a' },
      { token: 'type', foreground: '3a7a76' },
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#1E1830',
      'editorLineNumber.foreground': '#c8b8e8',
      'editorLineNumber.activeForeground': '#88739E',
      'editor.lineHighlightBackground': '#ede8f8',
      'editor.selectionBackground': '#c8b8e880',
      'editorCursor.foreground': '#88739E',
      'editor.inactiveSelectionBackground': '#ddd5ee',
      'editorIndentGuide.background': '#ddd5ee',
      'editorIndentGuide.activeBackground': '#c8b8e8',
      'scrollbarSlider.background': '#c8b8e880',
      'scrollbarSlider.hoverBackground': '#88739E80',
      'scrollbar.shadow': '#00000000',
    },
  },
}

function handleBeforeMount(monaco: typeof Monaco) {
  // Configure TypeScript/JavaScript language services before any editor or model
  // is created. This prevents the race condition where Monaco starts processing
  // the file before diagnostics are disabled.

  // Disable all diagnostics — Monaco has no access to node_modules or tsconfig,
  // so type errors and import resolution failures are always false positives.
  // noSyntacticValidation also silences the tsWorker "inmemory://model/1" race
  // where the worker requests diagnostics before the model URI is registered.
  const noValidation = {
    noSemanticValidation: true,
    noSyntacticValidation: true,
    noSuggestionDiagnostics: true,
  }
  monaco.typescript.typescriptDefaults.setDiagnosticsOptions(noValidation)
  monaco.typescript.javascriptDefaults.setDiagnosticsOptions(noValidation)

  // Enable JSX so TSX/JSX files parse without every '<' being a syntax error.
  const compilerOptions = {
    jsx: monaco.typescript.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    allowJs: true,
    target: monaco.typescript.ScriptTarget.ESNext,
  }
  monaco.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
}

// Minimum word length to bother the LLM about
const MIN_TOOLTIP_WORD_LEN = 2

export default function MonacoEditorPanel({ file, onChange, theme, colorScheme, addedLines }: Props) {
  const monaco = useMonaco()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationIds = useRef<string[]>([])
  const tooltipCache = useRef<Map<string, string>>(new Map())
  const tooltipProvider = useRef<Monaco.IDisposable | null>(null)

  const [previewMode, setPreviewMode] = useState(false)

  // Reset preview when navigating to a different file
  useEffect(() => {
    setPreviewMode(false)
  }, [file?.path])

  // Theme
  useEffect(() => {
    if (!monaco) return
    const key: ThemeKey = `${colorScheme}-${theme}`
    monaco.editor.defineTheme('chaos-theme', MONACO_THEMES[key])
    monaco.editor.setTheme('chaos-theme')
  }, [monaco, theme, colorScheme])

  // Diff decorations
  useEffect(() => {
    const editor = editorRef.current
    if (!editor || !monaco) return

    decorationIds.current = editor.deltaDecorations(decorationIds.current, [])

    if (!addedLines?.length) return

    const decorations: Monaco.editor.IModelDeltaDecoration[] = addedLines.map((line) => ({
      range: new monaco.Range(line, 1, line, 1),
      options: {
        isWholeLine: true,
        className: 'cc-diff-added',
        linesDecorationsClassName: 'cc-diff-added-gutter',
        overviewRuler: { color: '#22c55e80', position: monaco.editor.OverviewRulerLane.Left },
        minimap: { color: '#22c55e80', position: monaco.editor.MinimapPosition.Inline },
      },
    }))

    decorationIds.current = editor.deltaDecorations([], decorations)
  }, [addedLines, monaco, file?.path])

  // Tooltip hover provider — registered once when Monaco loads, disposed on unmount
  useEffect(() => {
    if (!monaco) return

    tooltipProvider.current?.dispose()

    tooltipProvider.current = monaco.languages.registerHoverProvider('*', {
      provideHover: async (model, position) => {
        // Skip markdown (has its own preview), skip very short files
        const lang = model.getLanguageId()
        if (lang === 'markdown') return null

        const wordInfo = model.getWordAtPosition(position)
        if (!wordInfo || wordInfo.word.length < MIN_TOOLTIP_WORD_LEN) return null

        const word = wordInfo.word
        const cacheKey = `${lang}:${word}`

        if (tooltipCache.current.has(cacheKey)) {
          return { contents: [{ value: tooltipCache.current.get(cacheKey)! }] }
        }

        // Gather ~5 lines around the cursor for context
        const lineCount = model.getLineCount()
        const start = Math.max(1, position.lineNumber - 2)
        const end = Math.min(lineCount, position.lineNumber + 2)
        const lines: string[] = []
        for (let i = start; i <= end; i++) lines.push(model.getLineContent(i))
        const context = lines.join('\n')

        try {
          const explanation = await window.api.getTooltip(word, context, lang)
          if (!explanation) return null
          tooltipCache.current.set(cacheKey, explanation)
          return { contents: [{ value: explanation }] }
        } catch {
          return null
        }
      },
    })

    return () => {
      tooltipProvider.current?.dispose()
    }
  }, [monaco])

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
        <div className="text-4xl text-subtle/20">⌗</div>
        <p className="text-sm text-secondary tracking-widest uppercase">No file open</p>
        <p className="text-xs text-muted">Open a folder and select a file to begin</p>
      </div>
    )
  }

  const isMarkdown = file.language === 'markdown'
  const syntaxTheme = theme === 'dark' ? atomDark : vs

  return (
    <div className="relative h-full w-full overflow-hidden">
      {/* Preview / Edit toggle for markdown files */}
      {isMarkdown && (
        <button
          onClick={() => setPreviewMode((p) => !p)}
          className="absolute top-2 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded text-[10px] uppercase tracking-widest font-medium border border-border/60 bg-surface-1/90 text-secondary hover:text-primary hover:border-border transition-colors backdrop-blur-sm select-none"
        >
          {previewMode ? '✎ Edit' : '⊞ Preview'}
        </button>
      )}

      {/* Markdown preview pane */}
      {isMarkdown && previewMode ? (
        <div className="h-full w-full overflow-y-auto px-12 py-10 bg-surface-0">
          <article className="max-w-2xl mx-auto text-[13.5px] leading-relaxed text-primary">
            <ReactMarkdown
              components={{
                code({ inline, className, children, ...props }: any) {
                  const match = /language-(\w+)/.exec(className || '')
                  const language = match ? match[1] : 'text'
                  if (inline) {
                    return (
                      <code className="bg-surface-2 px-1.5 py-0.5 rounded text-[12px] font-mono text-primary" {...props}>
                        {children}
                      </code>
                    )
                  }
                  return (
                    <div className="my-3 rounded-lg overflow-hidden">
                      <SyntaxHighlighter
                        language={language}
                        style={syntaxTheme}
                        customStyle={{
                          backgroundColor: theme === 'dark' ? 'rgba(15,15,15,0.6)' : 'rgba(248,250,252,1)',
                          padding: '14px',
                          borderRadius: '6px',
                          fontSize: '12px',
                          lineHeight: '1.6',
                        }}
                        {...props}
                      >
                        {String(children).replace(/\n$/, '')}
                      </SyntaxHighlighter>
                    </div>
                  )
                },
                h1({ children, ...props }: any) {
                  return <h1 className="text-xl font-bold mt-6 mb-3 text-primary border-b border-border/50 pb-2" {...props}>{children}</h1>
                },
                h2({ children, ...props }: any) {
                  return <h2 className="text-base font-bold mt-5 mb-2 text-primary" {...props}>{children}</h2>
                },
                h3({ children, ...props }: any) {
                  return <h3 className="text-sm font-semibold mt-4 mb-1.5 text-primary" {...props}>{children}</h3>
                },
                p({ children }: any) {
                  return <div className="my-2 text-primary">{children}</div>
                },
                ul({ children, ...props }: any) {
                  return <ul className="list-disc list-outside pl-5 my-2 space-y-1" {...props}>{children}</ul>
                },
                ol({ children, ...props }: any) {
                  return <ol className="list-decimal list-outside pl-5 my-2 space-y-1" {...props}>{children}</ol>
                },
                li({ children, ...props }: any) {
                  return <li className="text-primary" {...props}>{children}</li>
                },
                blockquote({ children, ...props }: any) {
                  return <blockquote className="border-l-2 border-accent-gemini/50 pl-4 my-3 text-secondary italic" {...props}>{children}</blockquote>
                },
                strong({ children, ...props }: any) {
                  return <strong className="font-semibold text-primary" {...props}>{children}</strong>
                },
                em({ children, ...props }: any) {
                  return <em className="italic text-secondary" {...props}>{children}</em>
                },
                a({ children, ...props }: any) {
                  return <a className="text-accent-gemini hover:text-accent-gemini/80 underline" target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
                },
                hr({ ...props }: any) {
                  return <hr className="my-5 border-border/50" {...props} />
                },
                table({ children, ...props }: any) {
                  return <div className="my-3 overflow-x-auto"><table className="w-full text-sm border-collapse" {...props}>{children}</table></div>
                },
                th({ children, ...props }: any) {
                  return <th className="text-left px-3 py-1.5 font-semibold border border-border/50 bg-surface-1" {...props}>{children}</th>
                },
                td({ children, ...props }: any) {
                  return <td className="px-3 py-1.5 border border-border/50" {...props}>{children}</td>
                },
              }}
            >
              {file.content}
            </ReactMarkdown>
          </article>
        </div>
      ) : (
        <Editor
          height="100%"
          path={file.path}
          language={file.language}
          value={file.content}
          theme={theme === 'dark' ? 'chaos-dark' : 'chaos-light'}
          beforeMount={handleBeforeMount}
          onMount={(editor) => { editorRef.current = editor }}
          onChange={(val) => onChange(val ?? '')}
          options={{
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 13,
            lineHeight: 22,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            renderWhitespace: 'selection',
            smoothScrolling: true,
            cursorBlinking: 'smooth',
            cursorSmoothCaretAnimation: 'on',
            padding: { top: 16, bottom: 16 },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            renderLineHighlight: 'gutter',
            folding: true,
            lineNumbers: 'on',
            wordWrap: 'off',
            tabSize: 2,
            insertSpaces: true,
            automaticLayout: true,
            bracketPairColorization: { enabled: true },
          }}
        />
      )}
    </div>
  )
}
