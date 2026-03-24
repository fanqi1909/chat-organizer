import type { PlatformAdapter, Message } from '../../shared/types'

/**
 * Claude.ai DOM adapter.
 *
 * Selectors may need updating if claude.ai changes its markup.
 * To verify: open DevTools on claude.ai, inspect the chat area.
 *
 * Known structure (as of early 2026):
 *   - Each conversation turn: div[data-testid="conversation-turn-*"]
 *   - Human turn marker:  div[data-testid="human-turn"]
 *   - AI turn marker:     div[data-testid="ai-turn"]  (or class containing "font-claude")
 *   - Input box:          div[contenteditable="true"][data-testid="chat-input"]
 */
export const claudeAdapter: PlatformAdapter = {
  name: 'claude',

  getChatContainer() {
    // The scrollable message list container
    return (
      document.querySelector('[data-testid="chat-messages"]') ??
      document.querySelector('main .overflow-y-auto') ??
      document.querySelector('main')
    )
  },

  getMessageElements() {
    return document.querySelectorAll('[data-testid^="conversation-turn-"]')
  },

  extractMessage(el: Element): Pick<Message, 'role' | 'text'> | null {
    const isHuman =
      el.querySelector('[data-testid="human-turn"]') !== null ||
      el.getAttribute('data-testid')?.includes('human') === true

    const isAssistant =
      el.querySelector('[data-testid="ai-turn"]') !== null ||
      el.getAttribute('data-testid')?.includes('assistant') === true

    if (!isHuman && !isAssistant) return null

    const textEl =
      el.querySelector('[data-testid="human-turn"] .whitespace-pre-wrap') ??
      el.querySelector('[data-testid="ai-turn"] .font-claude-message') ??
      el.querySelector('p') ??
      el

    const text = textEl.textContent?.trim() ?? ''
    if (!text) return null

    return { role: isHuman ? 'human' : 'assistant', text }
  },

  getInputBox() {
    return (
      (document.querySelector(
        '[data-testid="chat-input"][contenteditable="true"]',
      ) as HTMLElement | null) ??
      (document.querySelector(
        'div[contenteditable="true"]',
      ) as HTMLElement | null)
    )
  },

  insertIntoInputBox(text: string) {
    const input = this.getInputBox()
    if (!input) return

    // Focus then insert via execCommand (works with contenteditable React inputs)
    input.focus()
    document.execCommand('insertText', false, text)
  },
}
