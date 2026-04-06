import { useCallback, useEffect, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react'

export const PANEL_HANDLE_WIDTH = 8
export const PANEL_MIN_LEFT_WIDTH = 180
export const PANEL_MIN_RIGHT_WIDTH = 320
export const PANEL_MIN_CENTER_WIDTH = 420
export const PANEL_INITIAL_WIDTHS = { left: 240, right: 384 }

export type PanelSide = 'left' | 'right'

export interface CollapsedPanels {
  left: boolean
  right: boolean
}

export interface PanelWidths {
  left: number
  right: number
}

export interface PanelLayoutState {
  widths: PanelWidths
  collapsed: CollapsedPanels
}

export const PANEL_INITIAL_LAYOUT: PanelLayoutState = {
  widths: PANEL_INITIAL_WIDTHS,
  collapsed: { left: false, right: false },
}

const EMPTY_COLLAPSED: CollapsedPanels = { left: false, right: false }

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min
  return Math.min(max, Math.max(min, value))
}

function maxLeftWidth(containerWidth: number, rightWidth: number): number {
  return Math.max(
    PANEL_MIN_LEFT_WIDTH,
    containerWidth - rightWidth - PANEL_MIN_CENTER_WIDTH - PANEL_HANDLE_WIDTH * 2,
  )
}

function maxRightWidth(containerWidth: number, leftWidth: number): number {
  return Math.max(
    PANEL_MIN_RIGHT_WIDTH,
    containerWidth - leftWidth - PANEL_MIN_CENTER_WIDTH - PANEL_HANDLE_WIDTH * 2,
  )
}

export function clampPanelWidths(widths: PanelWidths, containerWidth: number, collapsed: CollapsedPanels = EMPTY_COLLAPSED): PanelWidths {
  const left = collapsed.left
    ? 0
    : clamp(widths.left, PANEL_MIN_LEFT_WIDTH, maxLeftWidth(containerWidth, collapsed.right ? 0 : widths.right))
  const right = collapsed.right
    ? 0
    : clamp(widths.right, PANEL_MIN_RIGHT_WIDTH, maxRightWidth(containerWidth, collapsed.left ? 0 : left))

  return {
    left: collapsed.left ? 0 : clamp(left, PANEL_MIN_LEFT_WIDTH, maxLeftWidth(containerWidth, right)),
    right,
  }
}

export function normalizePanelLayout(layout: PanelLayoutState, containerWidth: number): PanelLayoutState {
  return {
    widths: clampPanelWidths(layout.widths, containerWidth, layout.collapsed),
    collapsed: layout.collapsed,
  }
}

export function collapsePanelLayout(layout: PanelLayoutState, side: PanelSide): PanelLayoutState {
  if (layout.collapsed[side]) return layout

  return {
    widths: {
      ...layout.widths,
      [side]: 0,
    },
    collapsed: {
      ...layout.collapsed,
      [side]: true,
    },
  }
}

export function expandPanelLayout(
  layout: PanelLayoutState,
  side: PanelSide,
  containerWidth: number,
  restoreWidth: number,
): PanelLayoutState {
  if (!layout.collapsed[side]) return normalizePanelLayout(layout, containerWidth)

  const nextLayout: PanelLayoutState = {
    widths: {
      ...layout.widths,
      [side]: restoreWidth,
    },
    collapsed: {
      ...layout.collapsed,
      [side]: false,
    },
  }

  return normalizePanelLayout(nextLayout, containerWidth)
}

export function resizePanelLayout(
  layout: PanelLayoutState,
  side: PanelSide,
  delta: number,
  containerWidth: number,
  startWidths: PanelWidths,
): PanelLayoutState {
  const nextWidths = side === 'left'
    ? { left: startWidths.left + delta, right: startWidths.right }
    : { left: startWidths.left, right: startWidths.right - delta }

  return normalizePanelLayout({ widths: nextWidths, collapsed: layout.collapsed }, containerWidth)
}

interface UseResizablePanelsResult {
  leftWidth: number
  rightWidth: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  toggleCollapse: (side: PanelSide) => void
  startResize: (side: PanelSide) => (event: ReactPointerEvent<HTMLDivElement>) => void
}

export function useResizablePanels(containerRef: RefObject<HTMLElement>): UseResizablePanelsResult {
  const [layout, setLayout] = useState<PanelLayoutState>(PANEL_INITIAL_LAYOUT)
  const layoutRef = useRef(layout)
  const containerWidthRef = useRef(0)
  const lastExpandedWidthRef = useRef<PanelWidths>(PANEL_INITIAL_WIDTHS)
  const dragStateRef = useRef<{
    side: PanelSide
    startX: number
    startLeft: number
    startRight: number
  } | null>(null)

  useEffect(() => {
    layoutRef.current = layout

    if (!layout.collapsed.left && layout.widths.left > 0) {
      lastExpandedWidthRef.current.left = layout.widths.left
    }

    if (!layout.collapsed.right && layout.widths.right > 0) {
      lastExpandedWidthRef.current.right = layout.widths.right
    }
  }, [layout])

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current
    if (!dragState) return

    const containerWidth = containerWidthRef.current
    const delta = event.clientX - dragState.startX

    setLayout(() => {
      const nextLayout = resizePanelLayout(
        layoutRef.current,
        dragState.side,
        delta,
        containerWidth,
        { left: dragState.startLeft, right: dragState.startRight },
      )

      return nextLayout
    })
  }, [])

  const stopResize = useCallback(() => {
    dragStateRef.current = null
    document.body.classList.remove('is-panel-resizing')
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
  }, [handlePointerMove])

  const toggleCollapse = useCallback((side: PanelSide) => {
    const currentLayout = layoutRef.current

    if (currentLayout.collapsed[side]) {
      const restoreWidth = lastExpandedWidthRef.current[side] || PANEL_INITIAL_WIDTHS[side]
      const nextLayout = expandPanelLayout(currentLayout, side, containerWidthRef.current, restoreWidth)
      layoutRef.current = nextLayout
      setLayout(nextLayout)
      return
    }

    if (currentLayout.widths[side] > 0) {
      lastExpandedWidthRef.current[side] = currentLayout.widths[side]
    }

    const nextLayout = collapsePanelLayout(currentLayout, side)
    layoutRef.current = nextLayout
    setLayout(nextLayout)
  }, [])

  const startResize = useCallback((side: PanelSide) => {
    return (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return

      event.preventDefault()
      event.currentTarget.setPointerCapture(event.pointerId)

      const currentLayout = layoutRef.current
      const startingLayout = currentLayout.collapsed[side]
        ? expandPanelLayout(
            currentLayout,
            side,
            containerWidthRef.current,
            lastExpandedWidthRef.current[side] || PANEL_INITIAL_WIDTHS[side],
          )
        : currentLayout

      if (startingLayout !== currentLayout) {
        layoutRef.current = startingLayout
        setLayout(startingLayout)
      }

      dragStateRef.current = {
        side,
        startX: event.clientX,
        startLeft: startingLayout.widths.left,
        startRight: startingLayout.widths.right,
      }

      document.body.classList.add('is-panel-resizing')
      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', stopResize)
      window.addEventListener('pointercancel', stopResize)
    }
  }, [handlePointerMove, stopResize])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return

    const updateWidth = () => {
      containerWidthRef.current = element.getBoundingClientRect().width
      setLayout((prev) => normalizePanelLayout(prev, containerWidthRef.current))
    }

    updateWidth()

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateWidth)
      return () => window.removeEventListener('resize', updateWidth)
    }

    const observer = new ResizeObserver(() => updateWidth())
    observer.observe(element)

    return () => observer.disconnect()
  }, [containerRef])

  useEffect(() => () => {
    document.body.classList.remove('is-panel-resizing')
    window.removeEventListener('pointermove', handlePointerMove)
    window.removeEventListener('pointerup', stopResize)
    window.removeEventListener('pointercancel', stopResize)
  }, [handlePointerMove, stopResize])

  return {
    leftWidth: layout.collapsed.left ? 0 : layout.widths.left,
    rightWidth: layout.collapsed.right ? 0 : layout.widths.right,
    leftCollapsed: layout.collapsed.left,
    rightCollapsed: layout.collapsed.right,
    toggleCollapse,
    startResize,
  }
}


