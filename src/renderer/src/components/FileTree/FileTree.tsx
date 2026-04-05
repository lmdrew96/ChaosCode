import { useState } from 'react'
import type { FileNode } from '@/types'

interface Props {
  nodes: FileNode[]
  selectedPath: string | null
  pinnedPaths?: string[]
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
  onFileSelect,
  onPinFile,
}: {
  node: FileNode
  depth: number
  selectedPath: string | null
  pinnedPaths: string[]
  onFileSelect: (node: FileNode) => void
  onPinFile?: (node: FileNode) => void
}) {
  const [open, setOpen] = useState(depth === 0)
  const isSelected = node.path === selectedPath
  const isPinned = pinnedPaths.includes(node.path)
  const indent = depth * 12

  if (node.type === 'directory') {
    return (
      <div>
        <button
          className="flex items-center gap-1.5 w-full text-left py-0.5 px-2 text-xs text-white/50 hover:text-white/80 hover:bg-white/5 transition-colors rounded"
          style={{ paddingLeft: `${8 + indent}px` }}
          onClick={() => setOpen((o) => !o)}
        >
          <span className="text-white/30 text-[10px] w-3">{open ? '▾' : '▸'}</span>
          <span className="text-white/40 text-[11px]">󰉋</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            pinnedPaths={pinnedPaths}
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
          ? 'bg-white/10 text-white'
          : isPinned
            ? 'bg-accent-claude/10 text-white/70'
            : 'text-white/50 hover:text-white/80 hover:bg-white/5'
      }`}
      style={{ paddingLeft: `${8 + indent + 12}px` }}
    >
      <button className="flex items-center gap-1.5 flex-1 min-w-0" onClick={() => onFileSelect(node)}>
        <span className={`text-[11px] ${isPinned ? 'text-accent-claude/60' : 'text-white/30'}`}>
          {getFileIcon(node.name)}
        </span>
        <span className="truncate">{node.name}</span>
      </button>
      {onPinFile && (
        <button
          onClick={(e) => { e.stopPropagation(); onPinFile(node) }}
          title={isPinned ? 'Remove from agent context' : 'Add to agent context'}
          className={`flex-shrink-0 px-1 text-[9px] rounded opacity-0 group-hover:opacity-100 transition-opacity ${
            isPinned
              ? 'text-accent-claude/70 bg-accent-claude/20'
              : 'text-white/30 hover:text-white/60 bg-white/5'
          }`}
        >
          {isPinned ? '✓ ctx' : '+ ctx'}
        </button>
      )}
    </div>
  )
}

export default function FileTree({ nodes, selectedPath, pinnedPaths = [], onFileSelect, onPinFile, rootName }: Props) {
  return (
    <div className="flex flex-col h-full overflow-hidden">
      {rootName && (
        <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-white/20 border-b border-white/5 flex-shrink-0">
          {rootName}
        </div>
      )}
      <div className="flex-1 overflow-y-auto py-1">
        {nodes.length === 0 ? (
          <p className="px-3 py-4 text-[11px] text-white/20 text-center">No files</p>
        ) : (
          nodes.map((node) => (
            <TreeNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              pinnedPaths={pinnedPaths}
              onFileSelect={onFileSelect}
              onPinFile={onPinFile}
            />
          ))
        )}
      </div>
    </div>
  )
}
