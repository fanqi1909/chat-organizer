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
    // TODO: implement if threading is added for ChatGPT
  },

  /**
   * Find ChatGPT's conversation list container.
   * ChatGPT renders conversations in an <ol> inside <nav>.
   */
  getSidebarRecentsList(): HTMLElement | null {
    const nav = document.querySelector('nav')
    if (!nav) return null
    // ChatGPT puts conversation list in an <ol> inside nav
    const ol = nav.querySelector('ol')
    return (ol as HTMLElement | null)
  },

  /**
   * Get all conversation <li> items from the sidebar.
   */
  getSidebarConversationItems(): HTMLElement[] {
    const list = this.getSidebarRecentsList()
    if (!list) return []
    return Array.from(list.querySelectorAll(':scope > li')) as HTMLElement[]
  },
}
