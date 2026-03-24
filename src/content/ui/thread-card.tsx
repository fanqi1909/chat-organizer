import React from 'react'
import type { Thread } from '../../shared/types'
import { setPendingInject } from '../../shared/storage'

interface Props {
  thread: Thread
  onDelete: (threadId: string) => void
}

export function ThreadCard({ thread, onDelete }: Props) {
  const date = new Date(thread.archivedAt ?? thread.createdAt).toLocaleDateString()
  const preview = thread.messages[0]?.text.slice(0, 80) ?? ''

  async function handleOpen() {
    await setPendingInject(thread)
    chrome.tabs.create({ url: 'https://claude.ai/new' })
  }

  return (
    <div className="tp-card" onClick={handleOpen}>
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
