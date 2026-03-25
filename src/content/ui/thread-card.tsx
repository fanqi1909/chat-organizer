import React from 'react'
import type { Thread } from '../../shared/types'

interface Props {
  thread: Thread
  onDelete: (threadId: string) => void
  onOpen: (thread: Thread) => void
}

export function ThreadCard({ thread, onDelete, onOpen }: Props) {
  const date = new Date(thread.archivedAt ?? thread.createdAt).toLocaleDateString()
  const preview = thread.messages[0]?.text.slice(0, 80) ?? ''

  return (
    <div className="tp-card" onClick={() => onOpen(thread)}>
      <div className="tp-card-info">
        <div className="tp-card-title">{thread.title}</div>
        <div className="tp-card-preview">{preview}{preview.length === 80 ? '…' : ''}</div>
        <div className="tp-card-meta">{thread.messages.length} messages · {date}</div>
      </div>
      <button
        className="tp-btn-delete"
        onClick={(e) => { e.stopPropagation(); onDelete(thread.id) }}
      >
        ✕
      </button>
    </div>
  )
}
