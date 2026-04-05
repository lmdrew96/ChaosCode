import Editor, { useMonaco } from '@monaco-editor/react'
import { useEffect } from 'react'
import type { OpenFile } from '@/types'

interface Props {
  file: OpenFile | null
  onChange: (content: string) => void
}

const MONACO_THEME = {
  base: 'vs-dark' as const,
  inherit: true,
  rules: [
    { token: 'comment', foreground: '6a9955', fontStyle: 'italic' },
    { token: 'keyword', foreground: '569cd6' },
    { token: 'string', foreground: 'ce9178' },
    { token: 'number', foreground: 'b5cea8' },
    { token: 'type', foreground: '4ec9b0' },
  ],
  colors: {
    'editor.background': '#0f0f0f',
    'editor.foreground': '#d4d4d4',
    'editorLineNumber.foreground': '#3a3a3a',
    'editorLineNumber.activeForeground': '#6a6a6a',
    'editor.lineHighlightBackground': '#1a1a1a',
    'editor.selectionBackground': '#264f78',
    'editorCursor.foreground': '#d4a853',
    'editor.inactiveSelectionBackground': '#1e3a5f',
    'editorIndentGuide.background': '#2a2a2a',
    'editorIndentGuide.activeBackground': '#3a3a3a',
    'scrollbarSlider.background': '#38383880',
    'scrollbarSlider.hoverBackground': '#4a4a4a80',
    'scrollbar.shadow': '#00000000',
  }
}

export default function MonacoEditorPanel({ file, onChange }: Props) {
  const monaco = useMonaco()

  useEffect(() => {
    if (!monaco) return
    monaco.editor.defineTheme('chaos-dark', MONACO_THEME)
    monaco.editor.setTheme('chaos-dark')
  }, [monaco])

  if (!file) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 select-none">
        <div className="text-4xl opacity-10">⌗</div>
        <p className="text-sm text-white/20 tracking-widest uppercase">No file open</p>
        <p className="text-xs text-white/10">Open a folder and select a file to begin</p>
      </div>
    )
  }

  return (
    <Editor
      height="100%"
      language={file.language}
      value={file.content}
      theme="chaos-dark"
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
