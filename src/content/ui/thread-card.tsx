import React from 'react'
import type { Thread } from '../../shared/types'
import { setPendingInject } from '../../shared/storage'
import type { ContentToBackground } from '../../shared/types'

interface Props {
  thread: Thread
  onDelete: (threadId: string) => void
}

export function ThreadCard({ thread, onDelete }: Props) {
  const date = new Date(thread.archivedAt ?? thread.createdAt).toLocaleDateString()
  const preview = thread.messages[0]?.text.slice(0, 80) ?? ''

  async function handleOpen() {
    await setPendingInject(thread)
    const msg: ContentToBackground = { type: 'OPEN_THREAD_TAB', thread }
    chrome.runtime.sendMessage(msg)
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
