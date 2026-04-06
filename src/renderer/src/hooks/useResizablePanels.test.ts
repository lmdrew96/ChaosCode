import {
  PANEL_HANDLE_WIDTH,
  PANEL_INITIAL_WIDTHS,
  PANEL_INITIAL_LAYOUT,
  PANEL_MIN_CENTER_WIDTH,
  PANEL_MIN_LEFT_WIDTH,
  PANEL_MIN_RIGHT_WIDTH,
  collapsePanelLayout,
  clampPanelWidths,
  expandPanelLayout,
  normalizePanelLayout,
  resizePanelLayout,
} from './useResizablePanels'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function test(name: string, fn: () => void): void {
  try {
    fn()
    process.stdout.write(`PASS ${name}\n`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`FAIL ${name}: ${message}\n`)
    process.exitCode = 1
  }
}

const wideContainer = 1600
const handleSpace = PANEL_HANDLE_WIDTH * 2

test('keeps the default widths inside a wide container', () => {
  const result = clampPanelWidths(PANEL_INITIAL_WIDTHS, wideContainer)

  assert(result.left >= PANEL_MIN_LEFT_WIDTH, 'expected left panel to respect minimum width')
  assert(result.right >= PANEL_MIN_RIGHT_WIDTH, 'expected right panel to respect minimum width')
  assert(result.left + result.right + handleSpace + PANEL_MIN_CENTER_WIDTH <= wideContainer, 'expected panels to leave room for the editor')
})

test('clamps the left panel when dragged too wide', () => {
  const result = clampPanelWidths({ left: 900, right: 360 }, wideContainer)

  assert(result.left < 900, 'expected left panel to be clamped down')
  assert(result.left >= PANEL_MIN_LEFT_WIDTH, 'expected left panel to remain usable')
})

test('clamps the right panel when dragged too wide', () => {
  const result = clampPanelWidths({ left: 260, right: 1200 }, wideContainer)

  assert(result.right < 1200, 'expected right panel to be clamped down')
  assert(result.right >= PANEL_MIN_RIGHT_WIDTH, 'expected right panel to remain usable')
})

test('collapsing a panel sets its width to zero and preserves the other side', () => {
  const collapsed = collapsePanelLayout(PANEL_INITIAL_LAYOUT, 'left')

  assert(collapsed.collapsed.left, 'expected left panel to be marked collapsed')
  assert(collapsed.widths.left === 0, 'expected collapsed left panel width to be zero')
  assert(collapsed.widths.right === PANEL_INITIAL_WIDTHS.right, 'expected right panel width to stay unchanged')
})

test('expanding a collapsed panel restores it before resizing', () => {
  const collapsed = collapsePanelLayout(PANEL_INITIAL_LAYOUT, 'left')
  const restored = expandPanelLayout(collapsed, 'left', wideContainer, PANEL_INITIAL_WIDTHS.left)
  const dragged = resizePanelLayout(restored, 'left', 64, wideContainer, restored.widths)

  assert(!dragged.collapsed.left, 'expected left panel to be expanded for drag')
  assert(dragged.widths.left > PANEL_INITIAL_WIDTHS.left, 'expected drag to increase the restored width')
})

test('collapsed panels stay at zero during container shrink while expanded panels are clamped', () => {
  const tinyContainer = PANEL_MIN_LEFT_WIDTH + PANEL_MIN_RIGHT_WIDTH + PANEL_MIN_CENTER_WIDTH + handleSpace - 40
  const layout = normalizePanelLayout(
    {
      widths: { left: 0, right: 900 },
      collapsed: { left: true, right: false },
    },
    tinyContainer,
  )

  assert(layout.widths.left === 0, 'expected collapsed left panel to remain closed')
  assert(layout.widths.right >= PANEL_MIN_RIGHT_WIDTH, 'expected expanded right panel to remain usable')
})

if (process.exitCode && process.exitCode !== 0) {
  process.stderr.write('\nResizable panels harness failed.\n')
} else {
  process.stdout.write('\nResizable panels harness passed.\n')
}

