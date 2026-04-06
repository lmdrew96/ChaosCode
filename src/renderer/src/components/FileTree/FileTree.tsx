import { useState } from 'react'
import type { FileDiffSummary, FileNode } from '@/types'

interface Props {
  nodes: FileNode[]
  selectedPath: string | null
  pinnedPaths?: string[]
  fileDiffs?: Record<string, FileDiffSummary>
  onFileSelect: (node: FileNode) => void
  onPinFile?: (node: FileNode) => void
  rootName?: string
}

function getFileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase()
  const icons: Record<string, string> = {
    ts: '󰛦', tsx: '󰛦', js: '󰌞', jsx: '󰌞',
    json: '󰘦', md: '󰍔', css: '󰌜', html: '󰌝',
    py: '󰌠', rs: '󰆧', go: '󰟓', toml: '󰈙',
    yml: '󰈙', yaml: '󰈙', env: '󰙰', gitignore: '󰊢',
  }
  return icons[ext ?? ''] ?? '󰈙'
}

function TreeNode({
  node,
  depth,
  selectedPath,
  pinnedPaths,
  fileDiffs,
  onFileSelect,
  onPinFile,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  pinnedPaths: string[]
  fileDiffs: Record<string, FileDiffSummary>
  onFileSelect: (node: FileNode) => void
  onPinFile?: (node: FileNode) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const isSelected = node.path === selectedPath
  const isPinned = pinnedPaths.includes(node.path)
  const diff = fileDiffs[node.path]
  const indent = depth * 12

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className="flex items-center gap-1.5 w-full text-left py-0.5 px-2 text-xs text-secondary hover:text-primary hover:bg-surface-2 transition-colors rounded"
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-subtle text-[10px] w-3">{open ? '▾' : '▸'}</span>
          <span className="text-muted text-[11px]">󰉋</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            pinnedPaths={pinnedPaths}
            fileDiffs={fileDiffs}
            onFileSelect={onFileSelect}
            onPinFile={onPinFile}
          />
        ))}
      </div>
    )
  }

  return (
    <div
      className={`group flex items-center gap-1 w-full text-left py-0.5 pr-1 text-xs rounded transition-colors ${
        isSelected
          ? 'bg-surface-2 text-primary'
          : isPinned
            ? 'bg-accent-claude/10 text-primary'
            : 'text-secondary hover:text-primary hover:bg-surface-2'
      }`}
      style={{ paddingLeft: `${8 + indent + 12}px` }}
    >
      <button className="flex items-center gap-1.5 flex-1 min-w-0" onClick={() => onFileSelect(node)}>
        <span className={`text-[11px] ${isPinned ? 'text-accent-claude' : 'text-subtle'}`}>
          {getFileIcon(node.name)}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {diff && (diff.added > 0 || diff.removed > 0) && (
        <span className="flex flex-shrink-0 items-center gap-1 text-[9px] font-semibold tabular-nums">
          {diff.added > 0 && (
            <span className="rounded px-1 py-0.5 bg-emerald-400/10 text-emerald-400">
              +{diff.added}
            </span>
          )}
          {diff.removed > 0 && (
            <span className="rounded px-1 py-0.5 bg-danger/10 text-danger">
              -{diff.removed}
            </span>
          )}
        </span>
      )}
      {onPinFile && (
        <button
          onClick={(e) => { e.stopPropagation(); onPinFile(node) }}
          title={isPinned ? 'Remove from agent context' : 'Add to agent context'}
          className={`flex-shrink-0 px-1 text-[9px] rounded opacity-0 group-hover:opacity-100 transition-opacity ${
            isPinned
              ? 'text-accent-claude bg-accent-claude/20'
              : 'text-secondary hover:text-primary bg-surface-2'
          }`}
        >
          {isPinned ? '✓ ctx' : '+ ctx'}
        </button>
      )}
    </div>
  )
}

export default function FileTree({ nodes, selectedPath, pinnedPaths = [], fileDiffs = {}, onFileSelect, onPinFile, rootName }: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {rootName && (
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-subtle border-b border-border/70 flex-shrink-0">
          {rootName}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-muted text-center">No files</p>
        ) : (
          nodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              pinnedPaths={pinnedPaths}
              fileDiffs={fileDiffs}
              onFileSelect={onFileSelect}
              onPinFile={onPinFile}
            />
          ))
        )}
      </div>
    </div>
  )
}
