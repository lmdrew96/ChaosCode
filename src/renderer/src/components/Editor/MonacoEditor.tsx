import Editor, { useMonaco } from '@monaco-editor/react'
import { useEffect, useRef } from 'react'
import * as Monaco from 'monaco-editor'
import type { OpenFile } from '@/types'
import type { ColorScheme, ResolvedTheme } from '@/hooks/useTheme'

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

export default function MonacoEditorPanel({ file, onChange, theme, colorScheme, addedLines }: Props) {
  const monaco = useMonaco()
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null)
  const decorationIds = useRef<string[]>([])

  useEffect(() => {
    if (!monaco) return
    const key: ThemeKey = `${colorScheme}-${theme}`
    monaco.editor.defineTheme('chaos-theme', MONACO_THEMES[key])
    monaco.editor.setTheme('chaos-theme')
  }, [monaco, theme, colorScheme])

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
