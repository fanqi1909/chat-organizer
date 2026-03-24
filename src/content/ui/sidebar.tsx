import React, { useEffect, useState } from 'react'
import type { Thread } from '../../shared/types'
import { getArchivedThreads, deleteArchivedThread } from '../../shared/storage'
import { ThreadCard } from './thread-card'

interface Props {
  onQuote: (thread: Thread) => void
  /** Bump this to force a refresh when a new thread is archived */
  refreshKey: number
}

const styles = `
  .tp-sidebar {
    position: fixed;
    left: 0;
    top: 0;
    bottom: 0;
    width: 260px;
    background: #1a1a2e;
    color: #e2e8f0;
    display: flex;
    flex-direction: column;
    z-index: 9999;
    box-shadow: 2px 0 8px rgba(0,0,0,0.3);
    font-family: system-ui, sans-serif;
    font-size: 13px;
    overflow: hidden;
    transition: transform 0.2s ease;
  }
  .tp-sidebar-header {
    padding: 16px;
    border-bottom: 1px solid #2d2d4e;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  .tp-sidebar-title {
    font-weight: 700;
    font-size: 14px;
    color: #a78bfa;
    letter-spacing: 0.05em;
  }
  .tp-sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .tp-empty {
    color: #64748b;
    text-align: center;
    padding: 32px 16px;
    font-size: 12px;
  }
  .tp-card {
    background: #16213e;
    border-radius: 8px;
    margin-bottom: 8px;
    overflow: hidden;
    border: 1px solid #2d2d4e;
  }
  .tp-card-header {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    cursor: pointer;
    user-select: none;
  }
  .tp-card-header:hover { background: #1e2a4a; }
  .tp-card-chevron { color: #7c3aed; font-size: 12px; margin-top: 2px; }
  .tp-card-info { flex: 1; min-width: 0; }
  .tp-card-title {
    font-weight: 600;
    color: #e2e8f0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-card-meta { color: #64748b; font-size: 11px; margin-top: 2px; }
  .tp-card-body { padding: 0 12px 8px; }
  .tp-card-msg {
    padding: 4px 0;
    border-bottom: 1px solid #2d2d4e;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .tp-msg-role { font-size: 10px; font-weight: 600; color: #7c3aed; text-transform: uppercase; }
  .tp-msg-human .tp-msg-role { color: #06b6d4; }
  .tp-msg-text { color: #94a3b8; font-size: 12px; line-height: 1.4; }
  .tp-card-more { color: #64748b; font-size: 11px; padding: 4px 0; }
  .tp-card-actions {
    display: flex;
    gap: 6px;
    padding: 8px 12px;
    border-top: 1px solid #2d2d4e;
  }
  .tp-btn-quote, .tp-btn-delete {
    flex: 1;
    padding: 4px;
    border-radius: 4px;
    border: none;
    cursor: pointer;
    font-size: 11px;
    font-weight: 600;
    transition: opacity 0.15s;
  }
  .tp-btn-quote { background: #7c3aed; color: white; }
  .tp-btn-quote:hover { opacity: 0.85; }
  .tp-btn-delete { background: #2d2d4e; color: #94a3b8; }
  .tp-btn-delete:hover { background: #7f1d1d; color: white; }
`

export function Sidebar({ onQuote, refreshKey }: Props) {
  const [threads, setThreads] = useState<Thread[]>([])

  useEffect(() => {
    getArchivedThreads().then(setThreads)
  }, [refreshKey])

  async function handleDelete(threadId: string) {
    await deleteArchivedThread(threadId)
    setThreads((prev) => prev.filter((t) => t.id !== threadId))
  }

  return (
    <>
      <style>{styles}</style>
      <div className="tp-sidebar">
        <div className="tp-sidebar-header">
          <span className="tp-sidebar-title">Threads</span>
          <span style={{ color: '#64748b', fontSize: 11 }}>{threads.length} archived</span>
        </div>
        <div className="tp-sidebar-body">
          {threads.length === 0 ? (
            <div className="tp-empty">
              Archived threads will appear here.
              <br />
              <br />
              Chat on claude.ai and topics will be grouped automatically.
            </div>
          ) : (
            threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                onQuote={onQuote}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
