import React from 'react'
import type { Thread } from '../../shared/types'

interface Props {
  thread: Thread
  onArchive: () => void
}

const styles = `
  .tp-thread-group {
    border-left: 3px solid #7c3aed;
    margin: 8px 0;
    padding: 0 0 0 12px;
    position: relative;
  }
  .tp-thread-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 0 8px;
    font-size: 12px;
    font-weight: 600;
    color: #7c3aed;
    font-family: system-ui, sans-serif;
  }
  .tp-thread-title {
    flex: 1;
  }
  .tp-archive-btn {
    background: none;
    border: 1px solid #7c3aed;
    border-radius: 4px;
    color: #7c3aed;
    cursor: pointer;
    font-size: 11px;
    padding: 2px 8px;
    transition: background 0.15s;
  }
  .tp-archive-btn:hover {
    background: #7c3aed;
    color: white;
  }
`

export function ThreadGroup({ thread, onArchive }: Props) {
  return (
    <>
      <style>{styles}</style>
      <div className="tp-thread-group">
        <div className="tp-thread-header">
          <span className="tp-thread-title">
            # {thread.title} ({thread.messages.length} messages)
          </span>
          <button className="tp-archive-btn" onClick={onArchive}>
            Archive
          </button>
        </div>
      </div>
    </>
  )
}
