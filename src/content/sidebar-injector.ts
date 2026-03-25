import type { PlatformAdapter, Thread } from '../shared/types'
import { getThreadsByConversation, getAllActiveThreads } from '../shared/storage'

const TP_STYLES = `
  li[data-tp-active] > div > a .truncate {
    font-size: 10px !important;
    color: var(--text-text-500) !important;
    opacity: 0.5;
    order: 99;
  }
  li[data-tp-active] > div > a {
    flex-wrap: wrap;
    height: auto !important;
    min-height: 32px;
  }
  .tp-thread-container {
    padding: 2px 0 4px 12px;
  }
  .tp-active-thread {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: 13px;
    font-weight: 600;
    color: var(--text-text-100);
    border-radius: 6px;
    cursor: default;
  }
  .tp-active-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--accent-main-100, #7c3aed);
    flex-shrink: 0;
  }
  .tp-archived-thread {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 8px;
    font-size: 12px;
    color: var(--text-text-300, #999);
    border-radius: 6px;
    cursor: pointer;
    transition: background 0.1s;
  }
  .tp-archived-thread:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
  }
  .tp-thread-icon {
    font-size: 10px;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .tp-thread-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-thread-meta {
    font-size: 10px;
    opacity: 0.5;
    flex-shrink: 0;
  }
  .tp-thread-badge {
    position: absolute;
    right: 36px;
    top: 50%;
    transform: translateY(-50%);
    font-size: 9px;
    font-weight: 600;
    color: var(--text-text-500);
    background: var(--bg-bg-300, rgba(255,255,255,0.08));
    padding: 1px 5px;
    border-radius: 8px;
    cursor: pointer;
    z-index: 1;
    opacity: 0;
    transition: opacity 0.15s;
  }
  li:hover .tp-thread-badge,
  .tp-thread-badge.tp-expanded {
    opacity: 1;
  }
  .tp-show-more {
    font-size: 11px;
    color: var(--text-text-500);
    padding: 2px 8px;
    cursor: pointer;
    opacity: 0.7;
  }
  .tp-show-more:hover {
    opacity: 1;
  }
`

interface SidebarInjectorOptions {
  adapter: PlatformAdapter
  onOpenThread: (thread: Thread) => void
  getCurrentThread: () => Thread | null
  onArchive: () => Promise<void>
}

export class SidebarInjector {
  private observer: MutationObserver | null = null
  private debounceTimer: number | null = null
  private expandState = new Map<string, boolean>()
  private opts: SidebarInjectorOptions

  constructor(opts: SidebarInjectorOptions) {
    this.opts = opts
  }

  start() {
    this.injectStyles()
    this.observer = new MutationObserver(() => this.scheduleRefresh())
    const nav = document.querySelector('nav') ?? document.body
    this.observer.observe(nav, { childList: true, subtree: true })
    this.refresh()
  }

  stop() {
    this.observer?.disconnect()
    this.observer = null
    if (this.debounceTimer) cancelAnimationFrame(this.debounceTimer)
  }

  private injectStyles() {
    if (document.getElementById('tp-styles')) return
    const style = document.createElement('style')
    style.id = 'tp-styles'
    style.textContent = TP_STYLES
    document.head.appendChild(style)
  }

  private scheduleRefresh() {
    if (this.debounceTimer) cancelAnimationFrame(this.debounceTimer)
    this.debounceTimer = requestAnimationFrame(() => this.refresh())
  }

  async refresh() {
    const items = this.opts.adapter.getSidebarConversationItems()
    if (items.length === 0) return

    const threadsByConv = await getThreadsByConversation()
    const activeThreads = await getAllActiveThreads()
    const currentConvId = location.pathname.match(/\/chat\/([a-f0-9-]+)/)?.[1]

    for (const li of items) {
      const link = li.querySelector('a[href^="/chat/"]') as HTMLAnchorElement | null
      if (!link) continue

      const convId = link.getAttribute('href')?.match(/\/chat\/([a-f0-9-]+)/)?.[1]
      if (!convId) continue

      // Skip if already injected
      if (li.getAttribute('data-tp-injected') === 'true') continue

      const archivedThreads = threadsByConv[convId] ?? []
      const activeThread = currentConvId === convId
        ? this.opts.getCurrentThread()
        : activeThreads[convId] ?? null
      const totalThreads = archivedThreads.length + (activeThread ? 1 : 0)

      if (totalThreads === 0) continue

      li.setAttribute('data-tp-injected', 'true')

      const isCurrentConv = currentConvId === convId

      if (isCurrentConv) {
        // Current conversation: CSS-downgrade title, show threads prominently
        li.setAttribute('data-tp-active', 'true')
        const container = document.createElement('div')
        container.className = 'tp-thread-container'

        // Active thread (primary visual element)
        if (activeThread) {
          container.appendChild(this.createActiveThreadItem(activeThread))
        }

        // Archived threads (up to 3)
        const visibleArchived = archivedThreads.slice(0, 3)
        for (const thread of visibleArchived) {
          container.appendChild(this.createArchivedThreadItem(thread))
        }

        // "N more" link
        if (archivedThreads.length > 3) {
          const more = document.createElement('div')
          more.className = 'tp-show-more'
          more.textContent = `${archivedThreads.length - 3} more threads`
          more.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            // Show all threads
            more.remove()
            for (const thread of archivedThreads.slice(3)) {
              container.appendChild(this.createArchivedThreadItem(thread))
            }
          })
          container.appendChild(more)
        }

        li.appendChild(container)
      } else {
        // Non-current conversation: show badge only
        const relativeDiv = li.querySelector('div.relative')
        if (relativeDiv) {
          const badge = document.createElement('span')
          badge.className = 'tp-thread-badge'
          if (this.expandState.get(convId)) badge.classList.add('tp-expanded')
          badge.textContent = `${totalThreads}`
          badge.addEventListener('click', (e) => {
            e.stopPropagation()
            e.preventDefault()
            const expanded = !this.expandState.get(convId)
            this.expandState.set(convId, expanded)
            this.clearInjections()
            this.refresh()
          })
          relativeDiv.appendChild(badge)

          // If expanded, show thread list
          if (this.expandState.get(convId)) {
            badge.classList.add('tp-expanded')
            const container = document.createElement('div')
            container.className = 'tp-thread-container'
            if (activeThread) {
              container.appendChild(this.createActiveThreadItem(activeThread))
            }
            for (const thread of archivedThreads.slice(0, 5)) {
              container.appendChild(this.createArchivedThreadItem(thread))
            }
            li.appendChild(container)
          }
        }
      }
    }
  }

  private createActiveThreadItem(thread: Thread): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tp-active-thread'

    const dot = document.createElement('span')
    dot.className = 'tp-active-dot'

    const title = document.createElement('span')
    title.className = 'tp-thread-title'
    title.textContent = thread.title || 'New Thread'

    const meta = document.createElement('span')
    meta.className = 'tp-thread-meta'
    meta.textContent = `${thread.messages.length}m`

    el.appendChild(dot)
    el.appendChild(title)
    el.appendChild(meta)
    return el
  }

  private createArchivedThreadItem(thread: Thread): HTMLElement {
    const el = document.createElement('div')
    el.className = 'tp-archived-thread'

    const icon = document.createElement('span')
    icon.className = 'tp-thread-icon'
    icon.textContent = '#'

    const title = document.createElement('span')
    title.className = 'tp-thread-title'
    title.textContent = thread.title || 'Untitled Thread'

    const meta = document.createElement('span')
    meta.className = 'tp-thread-meta'
    meta.textContent = `${thread.messages.length}m`

    el.appendChild(icon)
    el.appendChild(title)
    el.appendChild(meta)

    el.addEventListener('click', (e) => {
      e.preventDefault()
      e.stopPropagation()
      this.opts.onOpenThread(thread)
    })

    return el
  }

  clearInjections() {
    document.querySelectorAll('[data-tp-injected]').forEach((el) => {
      el.removeAttribute('data-tp-injected')
      el.removeAttribute('data-tp-active')
      el.querySelector('.tp-thread-container')?.remove()
      el.querySelector('.tp-thread-badge')?.remove()
    })
  }
}
