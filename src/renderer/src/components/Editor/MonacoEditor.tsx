import Editor, { useMonaco } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import * as Monaco from 'monaco-editor'
import type { OpenFile } from '@/types'
import type { ResolvedTheme } from '@/hooks/useTheme'

// Suppress Monaco tsWorker race: getSyntacticDiagnostics fires on the transient
// inmemory://model/1 URI before noSyntacticValidation propagates. There is no
// public API to prevent this — suppressing the unhandled rejection is the only fix.
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
  /** 1-based line numbers changed by the last agentic write, for gutter highlighting */
  addedLines?: number[]
}

const MONACO_THEMES: Record<ResolvedTheme, Monaco.editor.IStandaloneThemeData> = {
  dark: {
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
  light: {
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
  monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions(noValidation)
  monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions(noValidation)

  // Enable JSX so TSX/JSX files parse without every '<' being a syntax error.
  const compilerOptions = {
    jsx: monaco.languages.typescript.JsxEmit.ReactJSX,
    allowSyntheticDefaultImports: true,
    esModuleInterop: true,
    allowJs: true,
    target: monaco.languages.typescript.ScriptTarget.ESNext,
  }
  monaco.languages.typescript.typescriptDefaults.setCompilerOptions(compilerOptions)
  monaco.languages.typescript.javascriptDefaults.setCompilerOptions(compilerOptions)
}

export default function MonacoEditorPanel({ file, onChange, theme, addedLines }: Props) {
  const monaco = useMonaco()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationIds = useRef<string[]>([])

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('chaos-dark', MONACO_THEMES.dark)
    monaco.editor.defineTheme('chaos-light', MONACO_THEMES.light)
    monaco.editor.setTheme(theme === 'dark' ? 'chaos-dark' : 'chaos-light')
  }, [monaco, theme])

  // Apply / clear diff decorations when addedLines or file changes
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

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
        <div className="text-4xl text-subtle/20">⌗</div>
        <p className="text-sm text-secondary tracking-widest uppercase">No file open</p>
        <p className="text-xs text-muted">Open a folder and select a file to begin</p>
      </div>
    )
  }

  return (
    <Editor
      height="100%"
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
  )
}
