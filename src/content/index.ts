import React from 'react'
import { createRoot } from 'react-dom/client'
import { getPlatformAdapter } from './platforms'
import { MessageObserver } from './observer'
import { ThreadManager } from './thread-manager'
import { Sidebar } from './ui/sidebar'
import { getSettings, getPendingInject, clearPendingInject } from '../shared/storage'
import type { ContentToBackground, BackgroundToContent, Message, Thread } from '../shared/types'

async function init() {
  const settings = await getSettings()
  if (!settings.threadingEnabled) return

  const adapter = getPlatformAdapter()
  if (!adapter) return

  // --- Check for pending thread inject (opened from archived thread click) ---
  await maybeInjectPendingThread(adapter)

  // --- Sidebar (single root, re-render on state change) ---
  const sidebarHost = document.createElement('div')
  sidebarHost.id = 'tp-sidebar-host'
  document.body.appendChild(sidebarHost)

  const sidebarShadow = sidebarHost.attachShadow({ mode: 'open' })
  const sidebarContainer = document.createElement('div')
  sidebarShadow.appendChild(sidebarContainer)
  const sidebarRoot = createRoot(sidebarContainer)

  let currentThread: Thread | null = null
  let sidebarRefreshKey = 0

  function renderSidebar() {
    sidebarRoot.render(
      React.createElement(Sidebar, {
        currentThread,
        onArchive: () => threadManager.archiveCurrentThread(),
        refreshKey: sidebarRefreshKey,
      }),
    )
  }

  renderSidebar()

  // Push page content right to make room for sidebar
  document.body.style.marginLeft = '260px'

  // --- Thread Manager ---
  const threadManager = new ThreadManager({
    onThreadUpdate: (thread) => {
      currentThread = thread
      renderSidebar()
    },
    onArchive: () => {
      sidebarRefreshKey++
      renderSidebar()
    },
  })

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
          threadManager.startNewThread(response.title, message)
        } else {
          threadManager.addMessageToCurrentThread(message)
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
      currentThread = null
      renderSidebar()
      observer.reset()
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
