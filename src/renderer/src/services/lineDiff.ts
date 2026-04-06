import type { FileDiffSummary } from '@/types'

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

export function countLineDiff(before: string, after: string): FileDiffSummary {
  const beforeLines = toLines(before)
  const afterLines = toLines(after)
  const shared = lcsLength(beforeLines, afterLines)

  // Greedy LCS walk to find which 1-based line numbers in `after` are new/changed.
  const addedLines: number[] = []
  let bi = 0
  for (let ai = 0; ai < afterLines.length; ai++) {
    if (bi < beforeLines.length && afterLines[ai] === beforeLines[bi]) {
      bi++
    } else {
      addedLines.push(ai + 1)
    }
  }

  return {
    added: afterLines.length - shared,
    removed: beforeLines.length - shared,
    addedLines,
  }
}

