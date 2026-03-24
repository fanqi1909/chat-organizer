import type { PlatformAdapter, Message } from '../shared/types'

type OnNewMessage = (message: Message, history: Message[]) => void

export class MessageObserver {
  private observer: MutationObserver | null = null
  private seenIds = new Set<string>()
  private history: Message[] = []

  constructor(
    private adapter: PlatformAdapter,
    private onNewMessage: OnNewMessage,
  ) {}

  start() {
    const container = this.adapter.getChatContainer()
    if (!container) {
      // Retry after a short delay — page may still be loading
      setTimeout(() => this.start(), 1000)
      return
    }

    this.observer = new MutationObserver(() => this.scanMessages())
    this.observer.observe(container, { childList: true, subtree: true })

    // Initial scan
    this.scanMessages()
  }

  stop() {
    this.observer?.disconnect()
    this.observer = null
  }

  private scanMessages() {
    const elements = this.adapter.getMessageElements()

    for (const el of elements) {
      // Use the element's position in DOM as a stable ID if none exists
      const id =
        el.getAttribute('data-testid') ??
        el.getAttribute('data-message-id') ??
        this.generateId(el)

      if (this.seenIds.has(id)) continue

      const extracted = this.adapter.extractMessage(el)
      if (!extracted) continue

      // Only trigger topic detection on completed assistant messages
      // (skip human messages — we'll batch them with the assistant reply)
      if (extracted.role === 'assistant' && !this.isStreamingInProgress(el)) {
        const message: Message = {
          id,
          role: extracted.role,
          text: extracted.text,
          timestamp: Date.now(),
        }

        this.seenIds.add(id)
        this.history.push(message)
        this.onNewMessage(message, [...this.history])
      } else if (extracted.role === 'human') {
        // Track human messages in history but don't trigger detection
        const message: Message = {
          id,
          role: extracted.role,
          text: extracted.text,
          timestamp: Date.now(),
        }
        this.seenIds.add(id)
        this.history.push(message)
      }
    }
  }

  /**
   * Heuristic: check if the assistant message is still streaming.
   * Claude.ai adds a cursor/spinner element while generating.
   */
  private isStreamingInProgress(el: Element): boolean {
    return (
      el.querySelector('[data-testid="streaming-indicator"]') !== null ||
      el.querySelector('.animate-pulse') !== null ||
      el.querySelector('.streaming') !== null
    )
  }

  private generateId(el: Element): string {
    const parent = el.parentElement
    if (!parent) return Math.random().toString(36).slice(2)
    const index = Array.from(parent.children).indexOf(el as HTMLElement)
    return `msg-${index}`
  }

  /** Reset when the user navigates to a new conversation */
  reset() {
    this.seenIds.clear()
    this.history = []
    this.observer?.disconnect()
    this.observer = null
    this.start()
  }
}
