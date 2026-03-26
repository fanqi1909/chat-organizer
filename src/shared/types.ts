export interface Message {
  id: string
  role: 'human' | 'assistant'
  text: string
  timestamp: number
}

export interface Thread {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  archivedAt?: number
  /** Which conversation URL this thread belongs to */
  conversationUrl: string
  conversationId?: string
}

export interface PlatformAdapter {
  /** Unique key for this platform */
  name: string
  /** Returns the scrollable chat messages container element */
  getChatContainer(): Element | null
  /** Extracts all current message elements from the DOM */
  getMessageElements(): NodeListOf<Element> | Element[]
  /** Extracts text and role from a single message element */
  extractMessage(el: Element): Pick<Message, 'role' | 'text'> | null
  /** Returns the main text input element */
  getInputBox(): HTMLElement | null
  /** Inserts text into the input box */
  insertIntoInputBox(text: string): void
  /** Submits the current input box content */
  submitInputBox(): void
  /** Find the Recents <ul> in claude.ai's native sidebar */
  getSidebarRecentsList(): HTMLElement | null
  /** Get all conversation <li> items from the Recents list */
  getSidebarConversationItems(): HTMLElement[]
}

export interface QAPair {
  convId: string
  convTitle: string
  question: string   // truncated to ~150 chars
  pairIndex: number  // 0-based index of this Q&A in the conversation
}

export interface TopicGroup {
  name: string
  pairs: QAPair[]
}

// Messages passed between content script and background service worker
export type ContentToBackground =
  | { type: 'NEW_MESSAGE'; message: Message; history: Message[] }
  | { type: 'RESTORE_THREAD'; thread: Thread }
  | { type: 'ORGANIZE_CONVERSATIONS'; conversations: Array<{ id: string; title: string }> }
  | { type: 'MERGE_TOPIC'; groupName: string; pairs: QAPair[] }

export type BackgroundToContent =
  | { type: 'THREAD_DECISION'; newThread: boolean; title: string }
  | { type: 'THREAD_RESTORED'; conversationId: string }
  | { type: 'THREAD_RESTORE_FAILED' }
  | { type: 'CONVERSATIONS_ORGANIZED'; groups: TopicGroup[] }
  | { type: 'ORGANIZE_FAILED' }
  | { type: 'TOPIC_MERGED'; conversationId: string }
  | { type: 'MERGE_FAILED' }
