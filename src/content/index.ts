import { getPlatformAdapter } from './platforms'
import { ConversationManager } from './conversation-manager'
import { MessageObserver } from './observer'
import { ThreadManager } from './thread-manager'
import { getSettings, getPendingInject, clearPendingInject, setPendingInject } from '../shared/storage'
import type { ContentToBackground, BackgroundToContent, Message, Thread } from '../shared/types'

async function init() {
  const settings = await getSettings()

  const adapterOrNull = getPlatformAdapter()
  if (!adapterOrNull) return
  const adapter = adapterOrNull

  // --- Conversation Manager (all platforms, no threading required) ---
  const convManager = new ConversationManager({
    adapter,
    onOpenThread: handleOpenThread,
  })
  convManager.start()

  // --- Claude-only: threading, message observation, pending thread injection ---
  let observer: MessageObserver | null = null
  let threadManager: ThreadManager | null = null

  if (adapter.name === 'claude' && settings.threadingEnabled) {
    await maybeInjectPendingThread(adapter)

    threadManager = new ThreadManager({
      onThreadUpdate: () => {},
      onArchive: () => {},
    })

    observer = new MessageObserver(adapter, async (message, history) => {
      await sendForDetection(message, history)
    })
    observer.start()
  }

  async function handleOpenThread(thread: Thread) {
    // Only relevant for Claude threading
    if (adapter.name !== 'claude' || !threadManager) return
    if (threadManager.getCurrentThread()) {
      await threadManager.archiveCurrentThread()
    }
    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'RESTORE_THREAD',
        thread,
      })) as BackgroundToContent
      if (response.type === 'THREAD_RESTORED') {
        window.location.href = `https://claude.ai/chat/${response.conversationId}`
        return
      }
    } catch (err) {
      console.warn('[ThreadPlugin] Restore failed, falling back to inject:', err)
    }
    await setPendingInject(thread)
    window.location.href = 'https://claude.ai/new'
  }

  async function sendForDetection(message: Message, history: Message[]) {
    if (!threadManager) return
    const request: ContentToBackground = { type: 'NEW_MESSAGE', message, history }
    try {
      const response = (await chrome.runtime.sendMessage(request)) as BackgroundToContent
      if (response.type === 'THREAD_DECISION') {
        if (response.newThread) {
          if (threadManager.getCurrentThread()) {
            await threadManager.archiveCurrentThread()
          }
          // Derive title from last human message if API didn't provide one
          const title = response.title || deriveTitleFromHistory(history)
          threadManager.startNewThread(title, message)
        } else {
          // If no current thread yet, start one (first message in a conversation)
          if (!threadManager.getCurrentThread()) {
            threadManager.startNewThread(deriveTitleFromHistory(history), message)
          } else {
            threadManager.addMessageToCurrentThread(message)
          }
        }
      }
    } catch (err) {
      console.error('[ThreadPlugin] Failed to send message to background:', err)
    }
  }

  // Reset on SPA navigation (all platforms)
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      if (observer) observer.reset()
      convManager.clearAndRefresh()
      if (adapter.name === 'claude') maybeInjectPendingThread(adapter)
      if (adapter.name === 'chatgpt') maybeInjectChatgptMerge(adapter)
    }
  }).observe(document, { subtree: true, childList: true })
}

/**
 * If this tab was opened by clicking an archived thread, inject that thread's
 * content into the input box so the user can continue in a fresh context.
 */
async function maybeInjectPendingThread(
  adapter: ReturnType<typeof getPlatformAdapter>,
) {
  if (!adapter) return

  const thread = await getPendingInject()
  if (!thread) return

  await clearPendingInject()

  // Wait for the input box to appear (new conversation page may not be ready yet)
  let attempts = 0
  const inject = () => {
    const input = adapter.getInputBox()
    if (input) {
      const context = buildThreadContext(thread)
      adapter.insertIntoInputBox(context)
      setTimeout(() => adapter.submitInputBox(), 300)
    } else if (attempts++ < 20) {
      setTimeout(inject, 500)
    }
  }
  inject()
}

function deriveTitleFromHistory(history: Message[]): string {
  // Use the last human message as the thread title
  const lastHuman = [...history].reverse().find((m) => m.role === 'human')
  const text = lastHuman?.text?.trim() ?? ''
  if (!text) return 'New Thread'
  // Truncate to ~50 chars, break at word boundary
  return text.length > 50 ? text.slice(0, 50).replace(/\s+\S*$/, '') + '…' : text
}

/**
 * If a ChatGPT merge was triggered, inject the primer text into the input box
 * so the user can start a new conversation from the merged topic context.
 * Does NOT auto-submit — the primer is long and the user should review it first.
 */
async function maybeInjectChatgptMerge(
  adapter: ReturnType<typeof getPlatformAdapter>,
) {
  if (!adapter) return

  const result = await chrome.storage.local.get('pending_chatgpt_merge')
  const text = result['pending_chatgpt_merge'] as string | undefined
  if (!text) return

  await chrome.storage.local.remove('pending_chatgpt_merge')

  let attempts = 0
  const inject = () => {
    const input = adapter.getInputBox()
    if (input) {
      adapter.insertIntoInputBox(text)
      // Don't auto-submit — user reviews primer and presses Enter
    } else if (attempts++ < 20) {
      setTimeout(inject, 500)
    }
  }
  inject()
}

function buildThreadContext(thread: Thread): string {
  const lines = [
    `[Continuing from archived thread: "${thread.title}"]`,
    '',
    ...thread.messages.map(
      (m) => `${m.role === 'human' ? 'You' : 'Claude'}: ${m.text.slice(0, 300)}`,
    ),
    '',
    '---',
    '',
  ]
  return lines.join('\n')
}

init()
