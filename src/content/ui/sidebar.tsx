import React, { useEffect, useState } from 'react'
import type { Thread } from '../../shared/types'
import { getArchivedThreads, deleteArchivedThread } from '../../shared/storage'
import { ThreadCard } from './thread-card'

interface Props {
  currentThread: Thread | null
  onArchive: () => void
  refreshKey: number
}

const styles = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  .tp-sidebar {
    position: fixed;
    left: 0; top: 0; bottom: 0;
    width: 260px;
    background: #f8f7f4;
    color: #1a1a1a;
    display: flex;
    flex-direction: column;
    z-index: 9999;
    border-right: 1px solid #e5e3de;
    font-family: system-ui, sans-serif;
    font-size: 13px;
  }
  .tp-sidebar-header {
    padding: 14px 14px 10px;
    border-bottom: 1px solid #e5e3de;
  }
  .tp-sidebar-title {
    font-weight: 700;
    font-size: 13px;
    color: #5c5c5c;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    margin-bottom: 10px;
  }
  /* Current thread box */
  .tp-current {
    background: #fff;
    border: 1px solid #e5e3de;
    border-radius: 8px;
    padding: 10px 12px;
  }
  .tp-current-label {
    font-size: 10px;
    font-weight: 600;
    color: #9a9a9a;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    margin-bottom: 4px;
  }
  .tp-current-title {
    font-size: 13px;
    font-weight: 600;
    color: #1a1a1a;
    margin-bottom: 8px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .tp-archive-btn {
    width: 100%;
    padding: 5px;
    background: #1a1a1a;
    color: #fff;
    border: none;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    transition: opacity 0.15s;
  }
  .tp-archive-btn:hover { opacity: 0.75; }
  .tp-no-thread {
    font-size: 12px;
    color: #b0aca5;
    text-align: center;
    padding: 6px 0;
  }
  /* Archived list */
  .tp-sidebar-body {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  .tp-section-label {
    font-size: 10px;
    font-weight: 600;
    color: #9a9a9a;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    padding: 6px 4px 4px;
  }
  .tp-empty {
    color: #b0aca5;
    text-align: center;
    padding: 24px 12px;
    font-size: 12px;
    line-height: 1.5;
  }
  /* Thread cards */
  .tp-card {
    background: #fff;
    border: 1px solid #e5e3de;
    border-radius: 8px;
    margin-bottom: 6px;
    padding: 10px 10px 10px 12px;
    cursor: pointer;
    display: flex;
    align-items: flex-start;
    gap: 6px;
    transition: background 0.1s;
  }
  .tp-card:hover { background: #f0ede8; }
  .tp-card-info { flex: 1; min-width: 0; }
  .tp-card-title {
    font-weight: 600;
    font-size: 13px;
    color: #1a1a1a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 3px;
  }
  .tp-card-preview {
    font-size: 12px;
    color: #6b6b6b;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    margin-bottom: 3px;
  }
  .tp-card-meta { font-size: 11px; color: #b0aca5; }
  .tp-btn-delete {
    background: none;
    border: none;
    color: #c0bbb5;
    cursor: pointer;
    font-size: 12px;
    padding: 2px 4px;
    border-radius: 4px;
    flex-shrink: 0;
    line-height: 1;
  }
  .tp-btn-delete:hover { background: #f0ede8; color: #e53e3e; }
`

export function Sidebar({ currentThread, onArchive, refreshKey }: Props) {
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
          <div className="tp-sidebar-title">Threads</div>
          <div className="tp-current">
            {currentThread ? (
              <>
                <div className="tp-current-label">Active</div>
                <div className="tp-current-title">{currentThread.title}</div>
                <button className="tp-archive-btn" onClick={onArchive}>
                  Archive thread
                </button>
              </>
            ) : (
              <div className="tp-no-thread">No active thread</div>
            )}
          </div>
        </div>

        <div className="tp-sidebar-body">
          {threads.length > 0 && (
            <div className="tp-section-label">Archived</div>
          )}
          {threads.length === 0 ? (
            <div className="tp-empty">
              Archive a thread to save it here.<br />
              Click any thread to open it in a new conversation.
            </div>
          ) : (
            threads.map((thread) => (
              <ThreadCard
                key={thread.id}
                thread={thread}
                onDelete={handleDelete}
              />
            ))
          )}
        </div>
      </div>
    </>
  )
}
