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
}

// Messages passed between content script and background service worker
export type ContentToBackground =
  | { type: 'NEW_MESSAGE'; message: Message; history: Message[] }
  | { type: 'OPEN_THREAD_TAB'; thread: Thread }

export type BackgroundToContent =
  | { type: 'THREAD_DECISION'; newThread: boolean; title: string }
