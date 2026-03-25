import type { PlatformAdapter, Message } from '../../shared/types'

/**
 * ChatGPT (chat.openai.com) DOM adapter — placeholder for future implementation.
 * Selectors TBD after inspecting ChatGPT's DOM structure.
 */
export const chatgptAdapter: PlatformAdapter = {
  name: 'chatgpt',

  getChatContainer() {
    // TODO: verify selector against chat.openai.com DOM
    return document.querySelector('main') ?? null
  },

  getMessageElements() {
    // TODO: verify selector against chat.openai.com DOM
    return document.querySelectorAll('[data-message-id]')
  },

  extractMessage(_el: Element): Pick<Message, 'role' | 'text'> | null {
    // TODO: implement ChatGPT message extraction
    return null
  },

  getInputBox() {
    // TODO: verify selector against chat.openai.com DOM
    return document.querySelector('#prompt-textarea') as HTMLElement | null
  },

  insertIntoInputBox(text: string) {
    const input = this.getInputBox()
    if (!input) return
    input.focus()
    document.execCommand('insertText', false, text)
  },

  submitInputBox() {
    // TODO: implement ChatGPT submit
  },

  getSidebarRecentsList() { return null },
  getSidebarConversationItems() { return [] },
}
