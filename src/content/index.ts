import React from 'react'
import { createRoot } from 'react-dom/client'
import { getPlatformAdapter } from './platforms'
import { MessageObserver } from './observer'
import { ThreadManager } from './thread-manager'
import { Sidebar } from './ui/sidebar'
import { ThreadGroup } from './ui/thread-group'
import { getSettings } from '../shared/storage'
import type { ContentToBackground, BackgroundToContent, Message, Thread } from '../shared/types'

async function init() {
  const settings = await getSettings()
  if (!settings.threadingEnabled) return

  const adapter = getPlatformAdapter()
  if (!adapter) return

  // --- Sidebar ---
  let sidebarRefreshKey = 0
  const sidebarHost = document.createElement('div')
  sidebarHost.id = 'tp-sidebar-host'
  document.body.appendChild(sidebarHost)

  // Use shadow DOM to isolate styles
  const sidebarShadow = sidebarHost.attachShadow({ mode: 'open' })
  const sidebarRoot = document.createElement('div')
  sidebarShadow.appendChild(sidebarRoot)

  function renderSidebar() {
    createRoot(sidebarRoot).render(
      React.createElement(Sidebar, {
        refreshKey: sidebarRefreshKey,
        onQuote: handleQuote,
      }),
    )
  }

  function handleQuote(thread: Thread) {
    const summary = `[Referencing thread: "${thread.title}"]\n${thread.messages
      .map((m) => `${m.role === 'human' ? 'You' : 'Claude'}: ${m.text.slice(0, 200)}`)
      .join('\n')}`
    adapter.insertIntoInputBox(summary)
  }

  renderSidebar()

  // Push page content to the right so sidebar doesn't overlap
  document.body.style.marginLeft = '260px'

  // --- Current thread indicator ---
  let threadIndicatorHost: HTMLElement | null = null
  let currentThreadRoot: ReturnType<typeof createRoot> | null = null

  function showThreadIndicator(thread: import('../shared/types').Thread | null) {
    if (!thread) {
      threadIndicatorHost?.remove()
      threadIndicatorHost = null
      currentThreadRoot = null
      return
    }

    if (!threadIndicatorHost) {
      threadIndicatorHost = document.createElement('div')
      threadIndicatorHost.id = 'tp-thread-indicator'
      threadIndicatorHost.style.cssText =
        'position:fixed;top:0;left:260px;right:0;z-index:9998;'
      document.body.appendChild(threadIndicatorHost)
      currentThreadRoot = createRoot(threadIndicatorHost)
    }

    currentThreadRoot!.render(
      React.createElement(ThreadGroup, {
        thread,
        onArchive: () => threadManager.archiveCurrentThread(),
      }),
    )
  }

  // --- Thread Manager ---
  const threadManager = new ThreadManager({
    onThreadUpdate: showThreadIndicator,
    onArchive: (_thread) => {
      sidebarRefreshKey++
      renderSidebar()
    },
  })

  // --- Message Observer ---
  const observer = new MessageObserver(adapter, async (message, history) => {
    await sendForDetection(message, history)
  })

  async function sendForDetection(message: Message, history: Message[]) {
    const request: ContentToBackground = {
      type: 'NEW_MESSAGE',
      message,
      history,
    }

    try {
      const response = (await chrome.runtime.sendMessage(
        request,
      )) as BackgroundToContent

      if (response.type === 'THREAD_DECISION') {
        if (response.newThread) {
          // Archive current thread before starting new one (if exists)
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

  // Reset observer on SPA navigation (claude.ai is a SPA)
  let lastUrl = location.href
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href
      observer.reset()
    }
  }).observe(document, { subtree: true, childList: true })
}

init()
