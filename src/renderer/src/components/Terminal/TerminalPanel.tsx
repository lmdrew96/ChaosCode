import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ColorScheme, ResolvedTheme } from '@/hooks/useTheme'

interface Props {
  cwd?: string
  theme: ResolvedTheme
  colorScheme: ColorScheme
}

const NORD_DARK_THEME = {
  background: '#2E3440',
  foreground: '#D8DEE9',
  cursor: '#D8DEE9',
  selectionBackground: '#434C5E',
  black: '#3B4252',
  red: '#BF616A',
  green: '#A3BE8C',
  yellow: '#EBCB8B',
  blue: '#81A1C1',
  magenta: '#B48EAD',
  cyan: '#88C0D0',
  white: '#E5ECEF',
  brightBlack: '#4C566A',
  brightRed: '#BF616A',
  brightGreen: '#A3BE8C',
  brightYellow: '#EBCB8B',
  brightBlue: '#81A1C1',
  brightMagenta: '#B48EAD',
  brightCyan: '#8FBCBB',
  brightWhite: '#ECEFF4',
}

const NORD_LIGHT_THEME = {
  background: '#D8DEE9',
  foreground: '#2E3440',
  cursor: '#2E3440',
  selectionBackground: '#C0C8D8',
  black: '#2E3440',
  red: '#BF616A',
  green: '#4C7A5C',
  yellow: '#A07A20',
  blue: '#5E81AC',
  magenta: '#8A5E8A',
  cyan: '#407E8A',
  white: '#D8DEE9',
  brightBlack: '#4C566A',
  brightRed: '#BF616A',
  brightGreen: '#4C7A5C',
  brightYellow: '#A07A20',
  brightBlue: '#5E81AC',
  brightMagenta: '#8A5E8A',
  brightCyan: '#407E8A',
  brightWhite: '#ECEFF4',
}

const ADHD_DARK_THEME = {
  background: '#1e1830',
  foreground: '#f0ecf8',
  cursor: '#88739E',
  selectionBackground: '#4a3a70',
  black: '#261e3c',
  red: '#e07070',
  green: '#97D181',
  yellow: '#DEA649',
  blue: '#88739E',
  magenta: '#DBD5E2',
  cyan: '#8CBDB9',
  white: '#b0a8d8',
  brightBlack: '#6a5a88',
  brightRed: '#e07070',
  brightGreen: '#97D181',
  brightYellow: '#DEA649',
  brightBlue: '#88739E',
  brightMagenta: '#DBD5E2',
  brightCyan: '#8CBDB9',
  brightWhite: '#f0ecf8',
}

const ADHD_LIGHT_THEME = {
  background: '#f5f1fc',
  foreground: '#1E1830',
  cursor: '#88739E',
  selectionBackground: '#c8b8e8',
  black: '#1E1830',
  red: '#c04040',
  green: '#4a8a3a',
  yellow: '#b87820',
  blue: '#88739E',
  magenta: '#6a5a80',
  cyan: '#3a7a76',
  white: '#807098',
  brightBlack: '#807098',
  brightRed: '#c04040',
  brightGreen: '#4a8a3a',
  brightYellow: '#b87820',
  brightBlue: '#88739E',
  brightMagenta: '#6a5a80',
  brightCyan: '#3a7a76',
  brightWhite: '#1E1830',
}

function getTerminalTheme(colorScheme: ColorScheme, resolvedTheme: ResolvedTheme) {
  if (colorScheme === 'nord') return resolvedTheme === 'dark' ? NORD_DARK_THEME : NORD_LIGHT_THEME
  if (colorScheme === 'adhd') return resolvedTheme === 'dark' ? ADHD_DARK_THEME : ADHD_LIGHT_THEME
  return resolvedTheme === 'dark' ? DARK_THEME : LIGHT_THEME
}

const DARK_THEME = {
  background: '#0f0f0f',
  foreground: '#d4d4d4',
  cursor: '#d4d4d4',
  selectionBackground: '#264f78',
  black: '#1e1e1e',
  red: '#f14c4c',
  green: '#23d18b',
  yellow: '#f5f543',
  blue: '#3b8eea',
  magenta: '#d670d6',
  cyan: '#29b8db',
  white: '#e5e5e5',
  brightBlack: '#666666',
  brightRed: '#f1897f',
  brightGreen: '#23d18b',
  brightYellow: '#f5f543',
  brightBlue: '#3b8eea',
  brightMagenta: '#d670d6',
  brightCyan: '#29b8db',
  brightWhite: '#e5e5e5',
}

const LIGHT_THEME = {
  background: '#ffffff',
  foreground: '#1a1a1a',
  cursor: '#1a1a1a',
  selectionBackground: '#add6ff',
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#666666',
  brightRed: '#cd3131',
  brightGreen: '#14ce14',
  brightYellow: '#b5ba00',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
}

export default function TerminalPanel({ cwd, theme, colorScheme }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  // Keep stable refs across re-renders for cleanup
  const termRef = useRef<Terminal | null>(null)
  const termIdRef = useRef<string | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 12,
      lineHeight: 1.4,
      cursorBlink: true,
      theme: getTerminalTheme(colorScheme, theme),
      allowTransparency: false,
      scrollback: 1000,
    })

    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(container)
    // Defer initial fit so the container has rendered dimensions
    requestAnimationFrame(() => fitAddon.fit())

    termRef.current = term
    fitAddonRef.current = fitAddon

    let unsubData: (() => void) | null = null
    let unsubExit: (() => void) | null = null
    let dataHandler: ((data: string) => void) | null = null

    window.api.terminalCreate(term.cols, term.rows, cwd).then((id) => {
      termIdRef.current = id

      unsubData = window.api.onTerminalData(id, (data) => term.write(data))
      unsubExit = window.api.onTerminalExit(id, () => {
        term.write('\r\n\x1b[90m[process exited — press any key to close]\x1b[0m\r\n')
      })

      dataHandler = term.onData((data) => {
        window.api.terminalWrite(id, data)
      }).dispose

      term.onResize(({ cols, rows }) => {
        window.api.terminalResize(id, cols, rows)
      })
    })

    const observer = new ResizeObserver(() => {
      fitAddon.fit()
    })
    observer.observe(container)

    return () => {
      observer.disconnect()
      unsubData?.()
      unsubExit?.()
      if (dataHandler) dataHandler()
      if (termIdRef.current) {
        window.api.terminalKill(termIdRef.current)
        termIdRef.current = null
      }
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  // Re-create the terminal when cwd, theme, or color scheme changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, theme, colorScheme])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      // xterm.js mounts its own canvas; pointer-events must reach it
      style={{ minHeight: 0 }}
    />
  )
}
