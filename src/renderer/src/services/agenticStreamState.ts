export interface AgenticCompletedFile {
  path: string
  content: string
}

/**
 * Filters completed file blocks so the same path+content pair is processed once,
 * even if seen in both incremental stream parsing and post-stream scan.
 */
export function selectNewCompletedFiles(
  files: AgenticCompletedFile[],
  lastQueuedByFile: Record<string, string>
): { files: AgenticCompletedFile[]; nextState: Record<string, string> } {
  const nextState = { ...lastQueuedByFile }
  const deduped: AgenticCompletedFile[] = []

  for (const file of files) {
    if (nextState[file.path] === file.content) continue
    nextState[file.path] = file.content
    deduped.push(file)
  }

  return { files: deduped, nextState }
}

