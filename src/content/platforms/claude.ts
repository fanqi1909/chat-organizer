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

  submitInputBox() {
    // Try the send button first
    const sendBtn = document.querySelector('button[aria-label="Send message"]') as HTMLButtonElement | null
    if (sendBtn && !sendBtn.disabled) {
      sendBtn.click()
      return
    }
    // Fallback: Enter keydown on input
    const input = this.getInputBox()
    if (!input) return
    input.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', keyCode: 13, which: 13,
      bubbles: true, cancelable: true,
    }))
  },

  getSidebarRecentsList(): HTMLElement | null {
    // Find the h2 with "Recents" text, then navigate to the sibling <ul>
    const headings = document.querySelectorAll('h2[role="button"]')
    for (const h2 of headings) {
      if (h2.textContent?.trim().startsWith('Recents')) {
        // Structure: h2 is inside a div, the <ul> is a sibling of that div's parent
        const headerWrapper = h2.closest('.flex.items-center.justify-between')
        if (headerWrapper) {
          const ul = headerWrapper.nextElementSibling
          if (ul?.tagName === 'UL') return ul as HTMLElement
        }
        // Fallback: look for sibling ul at parent level
        const parent = h2.parentElement?.parentElement
        if (parent) {
          const ul = parent.querySelector('ul')
          if (ul) return ul as HTMLElement
        }
      }
    }
    return null
  },

  getSidebarConversationItems(): HTMLElement[] {
    const ul = this.getSidebarRecentsList()
    if (!ul) return []
    return Array.from(ul.querySelectorAll(':scope > li')) as HTMLElement[]
  },
}
