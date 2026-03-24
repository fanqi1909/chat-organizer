import React, { useState } from 'react'
import type { Thread } from '../../shared/types'

interface Props {
  thread: Thread
  onQuote: (thread: Thread) => void
  onDelete: (threadId: string) => void
}

export function ThreadCard({ thread, onQuote, onDelete }: Props) {
  const [expanded, setExpanded] = useState(false)

  const date = new Date(thread.archivedAt ?? thread.createdAt).toLocaleDateString()

  return (
    <div className="tp-card">
      <div className="tp-card-header" onClick={() => setExpanded((e) => !e)}>
        <span className="tp-card-chevron">{expanded ? '▾' : '▸'}</span>
        <div className="tp-card-info">
          <div className="tp-card-title">{thread.title}</div>
          <div className="tp-card-meta">
            {thread.messages.length} messages · {date}
          </div>
        </div>
      </div>

      {expanded && (
        <div className="tp-card-body">
          {thread.messages.slice(0, 3).map((m) => (
            <div key={m.id} className={`tp-card-msg tp-msg-${m.role}`}>
              <span className="tp-msg-role">{m.role === 'human' ? 'You' : 'Claude'}</span>
              <span className="tp-msg-text">{m.text.slice(0, 120)}{m.text.length > 120 ? '…' : ''}</span>
            </div>
          ))}
          {thread.messages.length > 3 && (
            <div className="tp-card-more">+{thread.messages.length - 3} more messages</div>
          )}
        </div>
      )}

      <div className="tp-card-actions">
        <button className="tp-btn-quote" onClick={() => onQuote(thread)}>
          Quote
        </button>
        <button className="tp-btn-delete" onClick={() => onDelete(thread.id)}>
          Delete
        </button>
      </div>
    </div>
  )
}
