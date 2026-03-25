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
    this.observer = new MutationObserver(() => this.scanMessages())
    // Watch document.body — messages may not be inside <main>
    this.observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-is-streaming'] })

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
      // Build a stable ID: prefer data attributes, fall back to text fingerprint
      const id =
        el.getAttribute('data-message-id') ??
        (el.getAttribute('data-testid') === 'user-message'
          ? `human-${el.textContent?.trim().slice(0, 40)}`
          : `ai-${el.textContent?.trim().slice(0, 40)}`)

      if (this.seenIds.has(id)) continue

      const extracted = this.adapter.extractMessage(el)
      if (!extracted) continue

      // Only trigger topic detection on completed assistant messages
      // extractMessage returns null for data-is-streaming="true", so extracted.role === 'assistant' means complete
      if (extracted.role === 'assistant') {
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
