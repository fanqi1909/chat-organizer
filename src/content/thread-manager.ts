import type { Thread, Message } from '../shared/types'
import { saveArchivedThread, setActiveThread, clearActiveThread } from '../shared/storage'

export class ThreadManager {
  private currentThread: Thread | null = null
  private onThreadUpdate: (thread: Thread | null) => void
  private onArchive: (thread: Thread) => void

  constructor(options: {
    onThreadUpdate: (thread: Thread | null) => void
    onArchive: (thread: Thread) => void
  }) {
    this.onThreadUpdate = options.onThreadUpdate
    this.onArchive = options.onArchive
  }

  startNewThread(title: string, firstMessage: Message) {
    this.currentThread = {
      id: crypto.randomUUID(),
      title: title || 'New Thread',
      messages: [firstMessage],
      createdAt: Date.now(),
      conversationUrl: location.href,
      conversationId: location.pathname.match(/\/chat\/([a-f0-9-]+)/)?.[1],
    }
    this.onThreadUpdate(this.currentThread)
    // Persist active thread so sidebar can display it for all conversations
    const convId = this.currentThread.conversationId
    if (convId) {
      setActiveThread(convId, this.currentThread)
    }
  }

  addMessageToCurrentThread(message: Message) {
    if (!this.currentThread) {
      this.startNewThread('Conversation', message)
      return
    }
    this.currentThread.messages.push(message)
    this.onThreadUpdate({ ...this.currentThread })
    // Update persisted active thread
    const convId = this.currentThread.conversationId
    if (convId) {
      setActiveThread(convId, { ...this.currentThread })
    }
  }

  async archiveCurrentThread() {
    if (!this.currentThread) return
    const thread = { ...this.currentThread }
    await saveArchivedThread(thread)
    this.onArchive(thread)
    // Clear persisted active thread
    const convId = thread.conversationId
    if (convId) {
      await clearActiveThread(convId)
    }
    this.currentThread = null
    this.onThreadUpdate(null)
  }

  getCurrentThread() {
    return this.currentThread
  }
}
