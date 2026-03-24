import type { PlatformAdapter, Message } from '../../shared/types'

/**
 * Claude.ai DOM adapter.
 *
 * Verified structure (March 2026):
 *   - Messages container: div.flex-1.flex.flex-col.px-4.max-w-3xl
 *   - User messages:      [data-testid="user-message"] > p.whitespace-pre-wrap
 *   - AI messages:        [data-is-streaming]  ("false" = complete, "true" = streaming)
 *   - AI text:            .font-claude-response
 *   - Input box:          [data-testid="chat-input"]
 */
export const claudeAdapter: PlatformAdapter = {
  name: 'claude',

  getChatContainer() {
    return (
      document.querySelector('.flex-1.flex.flex-col.px-4.max-w-3xl') ??
      document.querySelector('main')
    )
  },

  getMessageElements() {
    const userMsgs = Array.from(document.querySelectorAll('[data-testid="user-message"]'))
    const aiMsgs = Array.from(document.querySelectorAll('[data-is-streaming]'))
    return [...userMsgs, ...aiMsgs].sort((a, b) =>
      a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
    )
  },

  extractMessage(el: Element): Pick<Message, 'role' | 'text'> | null {
    // User message
    if (el.getAttribute('data-testid') === 'user-message') {
      const text =
        el.querySelector('p.whitespace-pre-wrap')?.textContent?.trim() ??
        el.textContent?.trim() ??
        ''
      return text ? { role: 'human', text } : null
    }

    // AI message — skip if still streaming
    if (el.hasAttribute('data-is-streaming')) {
      if (el.getAttribute('data-is-streaming') === 'true') return null
      const text =
        el.querySelector('.font-claude-response')?.textContent?.trim() ?? ''
      return text ? { role: 'assistant', text } : null
    }

    return null
  },

  getInputBox() {
    return (
      (document.querySelector('[data-testid="chat-input"]') as HTMLElement | null) ??
      (document.querySelector('div[contenteditable="true"]') as HTMLElement | null)
    )
  },

  insertIntoInputBox(text: string) {
    const input = this.getInputBox()
    if (!input) return
    input.focus()
    document.execCommand('insertText', false, text)
  },
}
