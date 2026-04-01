import type { PlatformAdapter, Message } from '../../shared/types'

/**
 * ChatGPT (chatgpt.com) DOM adapter.
 *
 * Sidebar structure (as of early 2025):
 *   nav > div > div > ol  ← conversation list
 *     > li > a[href^="/c/"]
 *
 * DOM selectors verified against chatgpt.com; may need updating after ChatGPT redesigns.
 */
export const chatgptAdapter: PlatformAdapter = {
  name: 'chatgpt',

  getChatContainer() {
    return document.querySelector('main') ?? null
  },

  getMessageElements() {
    return document.querySelectorAll('[data-message-id]')
  },

  extractMessage(_el: Element): Pick<Message, 'role' | 'text'> | null {
    // TODO: implement if threading is added for ChatGPT
    return null
  },

  getInputBox() {
    return (
      document.querySelector('#prompt-textarea') as HTMLElement | null ??
      document.querySelector('textarea[data-id]') as HTMLElement | null
    )
  },

  insertIntoInputBox(text: string) {
    const input = this.getInputBox()
    if (!input) return
    input.focus()
    document.execCommand('insertText', false, text)
  },

  submitInputBox() {
    // Send button only appears when there is text — click it if available
    const btn = document.querySelector('[data-testid="send-button"]') as HTMLButtonElement | null
    if (btn && !btn.disabled) {
      btn.click()
    } else {
      // Fallback: Enter keydown on the input box
      const input = this.getInputBox()
      input?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    }
  },

  /**
   * Find ChatGPT's conversation list <ul>.
   * ChatGPT renders all conversations in: nav > div[class*=sidebar-expando-section] > #history > ul
   */
  getSidebarRecentsList(): HTMLElement | null {
    return document.querySelector('#history ul') as HTMLElement | null
  },

  /**
   * Get all conversation <li> items from the sidebar.
   * ChatGPT renders them as direct <li> children of #history > ul (no date grouping at li level).
   */
  getSidebarConversationItems(): HTMLElement[] {
    const ul = this.getSidebarRecentsList()
    if (!ul) return []
    return Array.from(ul.querySelectorAll(':scope > li')) as HTMLElement[]
  },
}
