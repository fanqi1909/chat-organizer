import type { PlatformAdapter, Thread, ConversationGroup } from '../shared/types'
import {
  getArchivedThreads,
  getThreadsByConversation,
  getAllActiveThreads,
  getConversationGroups,
  saveConversationGroups,
  clearConversationGroups,
  saveConvTitles,
  getConvTitles,
} from '../shared/storage'
import type { ContentToBackground, BackgroundToContent } from '../shared/types'

interface ConversationManagerOptions {
  adapter: PlatformAdapter
  onOpenThread: (thread: Thread) => void
}

const SECTION_ID = 'tp-conv-manager'

const SECTION_STYLES = `
  #tp-conv-manager {
    padding: 4px 0 8px;
    border-bottom: 1px solid var(--border-300, rgba(255,255,255,0.08));
    margin-bottom: 4px;
  }
  .tp-cm-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 6px 8px 4px 10px;
  }
  .tp-cm-title {
    font-size: 11px;
    font-weight: 600;
    color: var(--text-text-500, #666);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tp-cm-organize-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-text-400, #888);
    background: none;
    border: 1px solid var(--border-300, rgba(255,255,255,0.1));
    border-radius: 5px;
    padding: 2px 8px;
    cursor: pointer;
    transition: all 0.1s;
    position: relative;
  }
  .tp-cm-organize-btn:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.06));
    color: var(--text-text-200, #aaa);
  }
  .tp-cm-scope-menu {
    position: absolute;
    right: 0;
    top: 100%;
    margin-top: 2px;
    background: var(--bg-bg-300, #2a2a2a);
    border: 1px solid var(--border-300, rgba(255,255,255,0.1));
    border-radius: 6px;
    padding: 4px;
    z-index: 9999;
    min-width: 120px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.3);
  }
  .tp-cm-scope-item {
    display: block;
    padding: 6px 10px;
    font-size: 12px;
    color: var(--text-text-300, #999);
    cursor: pointer;
    border-radius: 4px;
    white-space: nowrap;
  }
  .tp-cm-scope-item:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.06));
    color: var(--text-text-100, #fff);
  }
  .tp-cm-body {
    padding: 0 4px;
  }
  .tp-cm-progress-bar {
    height: 2px;
    background: var(--bg-bg-300, rgba(255,255,255,0.08));
    margin: 0 8px 6px;
    border-radius: 2px;
    overflow: hidden;
  }
  .tp-cm-progress-fill {
    height: 100%;
    width: 40%;
    background: var(--accent-main-100, #7c3aed);
    border-radius: 2px;
    animation: tp-progress-slide 1.2s ease-in-out infinite;
  }
  @keyframes tp-progress-slide {
    0%   { transform: translateX(-100%); }
    50%  { transform: translateX(150%); }
    100% { transform: translateX(350%); }
  }
  .tp-cm-loading {
    text-align: center;
    padding: 6px 12px 12px;
    font-size: 11px;
    color: var(--text-text-500, #666);
  }
  .tp-cm-group {
    margin-bottom: 2px;
  }
  .tp-cm-group-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 6px;
    cursor: pointer;
    border-radius: 6px;
    font-size: 12px;
    color: var(--text-text-300, #999);
    transition: background 0.1s;
  }
  .tp-cm-group-header:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
  }
  .tp-cm-group-chevron {
    font-size: 9px;
    opacity: 0.5;
    transition: transform 0.15s;
    flex-shrink: 0;
  }
  .tp-cm-group-chevron.expanded {
    transform: rotate(90deg);
  }
  .tp-cm-group-name {
    flex: 1;
    font-weight: 500;
    color: var(--text-text-200, #bbb);
  }
  .tp-cm-group-count {
    font-size: 10px;
    opacity: 0.5;
  }
  .tp-cm-group-items {
    padding-left: 16px;
    display: none;
  }
  .tp-cm-group-items.expanded {
    display: block;
  }
  .tp-cm-conv-item {
    display: flex;
    align-items: center;
    padding: 3px 6px;
    border-radius: 5px;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-text-300, #999);
    transition: background 0.1s;
    gap: 4px;
  }
  .tp-cm-conv-item:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
    color: var(--text-text-100, #fff);
  }
  .tp-cm-conv-title {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-cm-thread-sub {
    padding-left: 12px;
    display: none;
  }
  .tp-cm-thread-sub.expanded {
    display: block;
  }
  .tp-cm-thread-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
    font-size: 11px;
    color: var(--text-text-400, #777);
    transition: background 0.1s;
  }
  .tp-cm-thread-item:hover {
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
    color: var(--text-text-200, #ccc);
  }
  .tp-cm-empty {
    padding: 12px 10px;
    font-size: 12px;
    color: var(--text-text-500, #666);
    text-align: center;
    line-height: 1.5;
  }
`

export class ConversationManager {
  private opts: ConversationManagerOptions
  private observer: MutationObserver | null = null
  private debounceTimer: number | null = null
  private groupExpandState = new Map<string, boolean>()
  private convExpandState = new Map<string, boolean>()
  private isOrganizing = false
  private isRefreshing = false
  private scopeMenuVisible = false

  constructor(opts: ConversationManagerOptions) {
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

  refresh() {
    if (this.debounceTimer) cancelAnimationFrame(this.debounceTimer)
    this.debounceTimer = requestAnimationFrame(() => this.doRefresh())
  }

  private scheduleRefresh() {
    this.refresh()
  }

  private injectStyles() {
    if (document.getElementById('tp-cm-styles')) return
    const style = document.createElement('style')
    style.id = 'tp-cm-styles'
    style.textContent = SECTION_STYLES
    document.head.appendChild(style)
  }

  private findInjectionPoint(): Element | null {
    // Find the Recents h2 heading
    const headings = document.querySelectorAll('h2[role="button"]')
    for (const h2 of headings) {
      if (h2.textContent?.trim().startsWith('Recents')) {
        // Walk up to find the container of both the header div and the <ul>
        // Structure: container > div.flex > h2 + container > ul
        const headerDiv = h2.closest('.flex.items-center.justify-between')
        if (headerDiv?.parentElement) {
          return headerDiv.parentElement
        }
        // Fallback: go up 2 levels from h2
        return h2.parentElement?.parentElement ?? null
      }
    }
    return null
  }

  private async doRefresh() {
    if (this.isRefreshing) return
    if (document.getElementById(SECTION_ID)) return

    const injectionPoint = this.findInjectionPoint()
    if (!injectionPoint || !injectionPoint.parentElement) return

    this.isRefreshing = true
    try {
      const section = await this.buildSection()
      // Re-check after async gap — another doRefresh may have injected while we awaited
      if (document.getElementById(SECTION_ID)) return
      injectionPoint.parentElement.insertBefore(section, injectionPoint)
    } finally {
      this.isRefreshing = false
    }
  }

  private async buildSection(): Promise<HTMLElement> {
    const section = document.createElement('div')
    section.id = SECTION_ID

    // Header
    const header = document.createElement('div')
    header.className = 'tp-cm-header'

    const title = document.createElement('span')
    title.className = 'tp-cm-title'
    title.textContent = 'Conversations'

    const btnGroup = document.createElement('div')
    btnGroup.style.cssText = 'display:flex;gap:4px;align-items:center;'

    const organizeBtn = document.createElement('button')
    organizeBtn.className = 'tp-cm-organize-btn'
    organizeBtn.textContent = this.isOrganizing ? '…' : 'Organize ▾'
    organizeBtn.disabled = this.isOrganizing
    organizeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleScopeMenu(organizeBtn)
    })

    const clearBtn = document.createElement('button')
    clearBtn.className = 'tp-cm-organize-btn'
    clearBtn.textContent = '✕'
    clearBtn.title = 'Clear organize results'
    clearBtn.style.cssText = 'padding: 2px 6px;'
    clearBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      await clearConversationGroups()
      this.groupExpandState.clear()
      const existing = document.getElementById(SECTION_ID)
      if (existing) {
        // Build new section while old one is still in DOM, then swap in-place.
        // Avoids doRefresh / findInjectionPoint race with React re-renders.
        this.isRefreshing = true
        try {
          const newSection = await this.buildSection()
          existing.replaceWith(newSection)
        } finally {
          this.isRefreshing = false
        }
      }
    })
    btnGroup.appendChild(clearBtn)

    btnGroup.appendChild(organizeBtn)
    header.appendChild(title)
    header.appendChild(btnGroup)
    section.appendChild(header)

    // Body
    const body = document.createElement('div')
    body.className = 'tp-cm-body'

    if (this.isOrganizing) {
      const loading = document.createElement('div')
      loading.className = 'tp-cm-loading'
      loading.textContent = 'Organizing conversations…'
      body.appendChild(loading)
    } else {
      const groups = await getConversationGroups()
      if (groups && groups.length > 0) {
        // Show organized groups
        const threadsByConv = await getThreadsByConversation()
        const convTitles = await getConvTitles()
        for (const group of groups) {
          body.appendChild(this.buildGroup(group, threadsByConv, convTitles))
        }
      } else {
        // Show flat list of conversations that have threads
        const threadsByConv = await getThreadsByConversation()
        const activeThreads = await getAllActiveThreads()
        const allConvIds = new Set([
          ...Object.keys(threadsByConv),
          ...Object.keys(activeThreads),
        ])

        if (allConvIds.size === 0) {
          const empty = document.createElement('div')
          empty.className = 'tp-cm-empty'
          empty.textContent = 'No threads yet. Chat for a bit, then click Organize.'
          body.appendChild(empty)
        } else {
          for (const convId of allConvIds) {
            const threads = [
              ...(activeThreads[convId] ? [activeThreads[convId]] : []),
              ...(threadsByConv[convId] ?? []),
            ]
            if (threads.length === 0) continue
            const convTitle = threads[0]?.conversationUrl
              ? await this.getTitleFromUrl(threads[0].conversationUrl, convId)
              : convId.slice(0, 8)
            body.appendChild(this.buildConvItem(convId, convTitle, threads))
          }
        }
      }
    }

    section.appendChild(body)
    return section
  }

  private buildGroup(
    group: ConversationGroup,
    threadsByConv: Record<string, Thread[]>,
    convTitles: Record<string, string> = {},
  ): HTMLElement {
    const container = document.createElement('div')
    container.className = 'tp-cm-group'

    const isExpanded = this.groupExpandState.get(group.name) ?? false

    const groupHeader = document.createElement('div')
    groupHeader.className = 'tp-cm-group-header'

    const chevron = document.createElement('span')
    chevron.className = `tp-cm-group-chevron ${isExpanded ? 'expanded' : ''}`
    chevron.textContent = '▶'

    const name = document.createElement('span')
    name.className = 'tp-cm-group-name'
    name.textContent = group.name

    const count = document.createElement('span')
    count.className = 'tp-cm-group-count'
    count.textContent = `${group.ids.length}`

    groupHeader.appendChild(chevron)
    groupHeader.appendChild(name)
    groupHeader.appendChild(count)

    groupHeader.addEventListener('click', (e) => {
      e.stopPropagation()
      const expanded = !this.groupExpandState.get(group.name)
      this.groupExpandState.set(group.name, expanded)
      chevron.classList.toggle('expanded', expanded)
      items.classList.toggle('expanded', expanded)
    })

    container.appendChild(groupHeader)

    const items = document.createElement('div')
    items.className = `tp-cm-group-items ${isExpanded ? 'expanded' : ''}`

    for (const convId of group.ids) {
      const threads = threadsByConv[convId] ?? []
      // Get title: thread title first (real topic), then DOM, then stored sidebar title, then short ID
      // Thread title is set by our extension from user messages — most accurate for restore convs
      const convTitle =
        threads[0]?.title ||
        this.getTitleFromDom(convId) ||
        convTitles[convId] ||
        convId.slice(0, 8)
      items.appendChild(this.buildConvItem(convId, convTitle, threads))
    }

    container.appendChild(items)
    return container
  }

  private buildConvItem(convId: string, title: string, threads: Thread[]): HTMLElement {
    const container = document.createElement('div')

    const isExpanded = this.convExpandState.get(convId) ?? false

    const item = document.createElement('div')
    item.className = 'tp-cm-conv-item'

    const convTitle = document.createElement('span')
    convTitle.className = 'tp-cm-conv-title'
    convTitle.textContent = title

    const count = document.createElement('span')
    count.style.cssText = 'font-size: 10px; opacity: 0.4; flex-shrink: 0;'
    count.textContent = threads.length > 0 ? `${threads.length}` : ''

    item.appendChild(convTitle)
    item.appendChild(count)

    item.addEventListener('click', (e) => {
      e.stopPropagation()
      window.location.href = `/chat/${convId}`
    })

    container.appendChild(item)

    // Thread sub-items
    const threadSub = document.createElement('div')
    threadSub.className = `tp-cm-thread-sub ${isExpanded ? 'expanded' : ''}`

    for (const thread of threads.slice(0, 5)) {
      const threadItem = document.createElement('div')
      threadItem.className = 'tp-cm-thread-item'
      threadItem.innerHTML = `<span style="opacity:0.4;font-size:10px;">#</span> <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${thread.title || 'Untitled'}</span> <span style="font-size:10px;opacity:0.4;">${thread.messages.length}m</span>`
      threadItem.addEventListener('click', (e) => {
        e.stopPropagation()
        this.opts.onOpenThread(thread)
      })
      threadSub.appendChild(threadItem)
    }

    container.appendChild(threadSub)
    return container
  }

  private getTitleFromDom(convId: string): string | null {
    const link = document.querySelector(`a[href="/chat/${convId}"]`)
    const span = link?.querySelector('.truncate')
    return span?.textContent?.trim() ?? null
  }

  private async getTitleFromUrl(url: string, fallback: string): Promise<string> {
    const convId = url.match(/\/chat\/([a-f0-9-]+)/)?.[1] ?? fallback
    return this.getTitleFromDom(convId) ?? fallback
  }

  private toggleScopeMenu(btn: HTMLButtonElement) {
    // Remove existing menu if open
    const existing = document.getElementById('tp-cm-scope-menu')
    if (existing) {
      existing.remove()
      this.scopeMenuVisible = false
      return
    }

    const menu = document.createElement('div')
    menu.id = 'tp-cm-scope-menu'
    menu.className = 'tp-cm-scope-menu'

    const scopes = [
      { label: 'Recent (10 convs)', limit: 10 },
      { label: 'Medium (30 convs)', limit: 30 },
      { label: 'All conversations', limit: 0 },
    ]

    for (const scope of scopes) {
      const item = document.createElement('div')
      item.className = 'tp-cm-scope-item'
      item.textContent = scope.label
      item.addEventListener('click', (e) => {
        e.stopPropagation()
        menu.remove()
        this.scopeMenuVisible = false
        this.runOrganize(scope.limit)
      })
      menu.appendChild(item)
    }

    btn.appendChild(menu)
    this.scopeMenuVisible = true

    // Close on outside click
    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== btn) {
        menu.remove()
        this.scopeMenuVisible = false
        document.removeEventListener('click', closeMenu)
      }
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  }

  private async runOrganize(limit: number) {
    // Collect conversation IDs and titles from the Recents sidebar DOM
    // The background will fetch actual message content via the claude.ai API
    const items = this.opts.adapter.getSidebarConversationItems()

    const conversations: Array<{ id: string; title: string }> = []

    const limited = limit > 0 ? items.slice(0, limit) : items
    for (const li of limited) {
      const link = li.querySelector('a[href^="/chat/"]') as HTMLAnchorElement | null
      if (!link) continue
      const convId = link.getAttribute('href')?.match(/\/chat\/([a-f0-9-]+)/)?.[1]
      if (!convId) continue
      const titleEl = link.querySelector('.truncate')
      const title = titleEl?.textContent?.trim() ?? convId.slice(0, 8)
      conversations.push({ id: convId, title })
    }

    if (conversations.length === 0) return

    // Show loading state in-place (don't remove section)
    this.isOrganizing = true
    this.showLoadingState()

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'ORGANIZE_CONVERSATIONS',
        conversations,
      } as ContentToBackground)) as BackgroundToContent

      if (response.type === 'CONVERSATIONS_ORGANIZED') {
        await saveConversationGroups(response.groups)
        await saveConvTitles(response.convTitles)
      }
    } catch (err) {
      console.error('[ThreadPlugin] Organize failed:', err)
    } finally {
      this.isOrganizing = false
      // Re-render the section body with results
      document.getElementById(SECTION_ID)?.remove()
      this.isRefreshing = false
      await this.doRefresh()
    }
  }

  private showLoadingState() {
    const section = document.getElementById(SECTION_ID)
    if (!section) return

    // Update button
    const btn = section.querySelector('.tp-cm-organize-btn') as HTMLButtonElement | null
    if (btn) { btn.textContent = 'Organizing…'; btn.disabled = true }

    // Replace body with progress bar + text
    const body = section.querySelector('.tp-cm-body')
    if (body) {
      body.innerHTML = ''

      const bar = document.createElement('div')
      bar.className = 'tp-cm-progress-bar'
      const fill = document.createElement('div')
      fill.className = 'tp-cm-progress-fill'
      bar.appendChild(fill)

      const label = document.createElement('div')
      label.className = 'tp-cm-loading'
      label.textContent = `Analyzing ${this.opts.adapter.getSidebarConversationItems().length} conversations…`

      body.appendChild(bar)
      body.appendChild(label)
    }
  }

  clearAndRefresh() {
    this.isRefreshing = false
    document.getElementById(SECTION_ID)?.remove()
    // Use setTimeout to let the DOM settle before re-injecting
    setTimeout(() => this.refresh(), 50)
  }
}
