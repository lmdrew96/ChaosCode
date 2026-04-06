import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import type { ResolvedTheme } from '@/hooks/useTheme'

interface Props {
  cwd?: string
  theme: ResolvedTheme
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

export default function TerminalPanel({ cwd, theme }: Props) {
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
      theme: theme === 'dark' ? DARK_THEME : LIGHT_THEME,
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
  // Re-create the terminal when cwd or theme changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd, theme])

  return (
    <div
      ref={containerRef}
      className="h-full w-full overflow-hidden"
      // xterm.js mounts its own canvas; pointer-events must reach it
      style={{ minHeight: 0 }}
    />
  )
}
