import { getPlatformAdapter } from './platforms'
import { ConversationManager } from './conversation-manager'
import { MessageObserver } from './observer'
import { ThreadManager } from './thread-manager'
import { SidebarInjector } from './sidebar-injector'
import { getSettings, getPendingInject, clearPendingInject, setPendingInject } from '../shared/storage'
import type { ContentToBackground, BackgroundToContent, Message, Thread } from '../shared/types'

async function init() {
  const settings = await getSettings()
  if (!settings.threadingEnabled) return

  const adapter = getPlatformAdapter()
  if (!adapter) return

  await maybeInjectPendingThread(adapter)

  // --- Thread Manager ---
  const threadManager = new ThreadManager({
    onThreadUpdate: () => {
      injector.clearInjections()
      injector.refresh()
    },
    onArchive: () => {
      injector.clearInjections()
      injector.refresh()
    },
  })

  // --- Sidebar Injector (replaces old custom sidebar) ---
  const injector = new SidebarInjector({
    adapter,
    onOpenThread: handleOpenThread,
    getCurrentThread: () => threadManager.getCurrentThread(),
    onArchive: () => threadManager.archiveCurrentThread(),
  })
  injector.start()

  // --- Conversation Manager ---
  const convManager = new ConversationManager({
    adapter,
    onOpenThread: handleOpenThread,
  })
  convManager.start()

  async function handleOpenThread(thread: Thread) {
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

  // --- Message Observer ---
  const observer = new MessageObserver(adapter, async (message, history) => {
    await sendForDetection(message, history)
  })

  async function sendForDetection(message: Message, history: Message[]) {
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

  observer.start()

  // Reset on SPA navigation
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      injector.clearInjections()
      injector.refresh()
      observer.reset()
      convManager.clearAndRefresh()
      maybeInjectPendingThread(adapter)
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
