import type { PlatformAdapter, Thread, TopicGroup, QAPair } from '../shared/types'
import {
  getTopicGroups,
  saveTopicGroups,
  mergeTopicGroups,
  clearTopicGroups,
  getMergedGroups,
  addMergedGroup,
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
    font-size: 12px;
    font-weight: 600;
    color: var(--text-text-500, #666);
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }
  .tp-cm-header-actions {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tp-cm-clear-btn {
    font-size: 12px;
    color: var(--text-text-500, #666);
    background: none;
    border: none;
    padding: 3px 6px;
    cursor: pointer;
    border-radius: 4px;
  }
  .tp-cm-clear-btn:hover {
    color: var(--text-text-300, #999);
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
  }
  .tp-cm-organize-btn {
    font-size: 12px;
    font-weight: 500;
    color: var(--text-text-400, #888);
    background: none;
    border: 1px solid var(--border-300, rgba(255,255,255,0.1));
    border-radius: 5px;
    padding: 3px 10px;
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
  .tp-cm-merge-btn {
    font-size: 11px;
    font-weight: 500;
    color: var(--text-text-400, #888);
    background: none;
    border: 1px solid var(--border-300, rgba(255,255,255,0.12));
    padding: 2px 8px;
    cursor: pointer;
    border-radius: 4px;
    opacity: 0.5;
    transition: opacity 0.1s, color 0.1s, background 0.1s;
    flex-shrink: 0;
    line-height: 1.6;
    white-space: nowrap;
  }
  .tp-cm-group-header:hover .tp-cm-merge-btn {
    opacity: 1;
  }
  .tp-cm-merge-btn:hover {
    color: var(--accent-main-100, #7c3aed);
    border-color: var(--accent-main-100, #7c3aed);
    background: var(--bg-bg-200, rgba(255,255,255,0.05));
  }
  .tp-cm-merge-btn:disabled {
    opacity: 0.3;
    cursor: default;
  }
  .tp-cm-merged-badge {
    font-size: 10px;
    color: var(--accent-main-100, #7c3aed);
    opacity: 0.7;
    flex-shrink: 0;
    line-height: 1.4;
  }
  .tp-cm-group-items {
    padding-left: 8px;
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
  .tp-cm-pair-conv-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--text-text-500, #888);
    background: var(--bg-bg-300, rgba(255,255,255,0.06));
    border-radius: 3px;
    padding: 1px 5px;
    flex-shrink: 0;
    max-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .tp-cm-pair-question {
    flex: 1;
    margin-left: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-text-300, #999);
    font-size: 11px;
  }
  .tp-cm-conv-delete {
    display: none;
    background: none;
    border: none;
    color: var(--text-text-500, #666);
    font-size: 10px;
    cursor: pointer;
    padding: 0 2px;
    flex-shrink: 0;
    line-height: 1;
  }
  .tp-cm-conv-item:hover .tp-cm-conv-delete {
    display: block;
  }
  .tp-cm-conv-delete:hover {
    color: #e55;
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

  /** Return the URL path for a conversation, platform-aware. */
  private convPath(id: string): string {
    return this.opts.adapter.name === 'chatgpt' ? `/c/${id}` : `/chat/${id}`
  }

  private findInjectionPoint(): Element | null {
    if (this.opts.adapter.name === 'chatgpt') {
      // ChatGPT: inject before the expando section containing #history
      // Structure: nav > div.group/sidebar-expando-section > #history > ul
      const history = document.querySelector('#history')
      if (!history) return null
      // Walk up to find the direct child of nav that contains #history
      return history.closest('nav > div') ?? null
    }

    // Claude: Find the Recents h2 heading
    const headings = document.querySelectorAll('h2[role="button"]')
    for (const h2 of headings) {
      if (h2.textContent?.trim().startsWith('Recents')) {
        // Walk up to find the container of both the header div and the <ul>
        const headerDiv = h2.closest('.flex.items-center.justify-between')
        if (headerDiv?.parentElement) {
          return headerDiv.parentElement
        }
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

    const actions = document.createElement('div')
    actions.className = 'tp-cm-header-actions'

    const groups = await getTopicGroups()
    const hasGroups = groups && groups.length > 0

    if (hasGroups) {
      const clearBtn = document.createElement('button')
      clearBtn.className = 'tp-cm-clear-btn'
      clearBtn.textContent = '✕'
      clearBtn.title = 'Clear groups'
      clearBtn.addEventListener('click', async (e) => {
        e.stopPropagation()
        await clearTopicGroups()
        this.groupExpandState.clear()
        const existing = document.getElementById(SECTION_ID)
        if (existing) {
          this.isRefreshing = true
          try {
            const newSection = await this.buildSection()
            existing.replaceWith(newSection)
          } finally {
            this.isRefreshing = false
          }
        }
      })
      actions.appendChild(clearBtn)
    }

    const organizeBtn = document.createElement('button')
    organizeBtn.className = 'tp-cm-organize-btn'
    organizeBtn.textContent = this.isOrganizing ? '…' : 'Organize ▾'
    organizeBtn.disabled = this.isOrganizing
    organizeBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      this.toggleScopeMenu(organizeBtn)
    })

    actions.appendChild(organizeBtn)
    header.appendChild(title)
    header.appendChild(actions)
    section.appendChild(header)

    // Body
    const body = document.createElement('div')
    body.className = 'tp-cm-body'

    if (this.isOrganizing) {
      const loading = document.createElement('div')
      loading.className = 'tp-cm-loading'
      loading.textContent = 'Extracting Q&A pairs…'
      body.appendChild(loading)
    } else if (hasGroups) {
      const mergedGroups = await getMergedGroups()
      for (const group of groups) {
        body.appendChild(this.buildGroup(group, mergedGroups))
      }
    } else {
      const empty = document.createElement('div')
      empty.className = 'tp-cm-empty'
      empty.textContent = 'Click Organize ▾ to group your conversations by topic.'
      body.appendChild(empty)
    }

    section.appendChild(body)
    return section
  }

  private buildGroup(group: TopicGroup, mergedGroups: Set<string> = new Set()): HTMLElement {
    const container = document.createElement('div')
    container.className = 'tp-cm-group'

    const isExpanded = this.groupExpandState.get(group.name) ?? false
    const isMerged = mergedGroups.has(group.name)

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
    count.textContent = `${group.pairs.length}`

    if (isMerged) {
      const badge = document.createElement('span')
      badge.className = 'tp-cm-merged-badge'
      badge.textContent = '✓'
      badge.title = 'Already merged into a session'
      groupHeader.appendChild(chevron)
      groupHeader.appendChild(name)
      groupHeader.appendChild(count)
      groupHeader.appendChild(badge)
    } else {
      const mergeBtn = document.createElement('button')
      mergeBtn.className = 'tp-cm-merge-btn'
      mergeBtn.textContent = '↗ New Session'
      mergeBtn.title = `Open "${group.name}" as a new session with summarized context`
      mergeBtn.addEventListener('click', (e) => {
        e.stopPropagation()
        this.runMerge(group.name, group.pairs, mergeBtn)
      })
      groupHeader.appendChild(chevron)
      groupHeader.appendChild(name)
      groupHeader.appendChild(count)
      groupHeader.appendChild(mergeBtn)
    }

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

    for (const pair of group.pairs) {
      items.appendChild(this.buildPairItem(pair))
    }

    container.appendChild(items)
    return container
  }

  private buildPairItem(pair: QAPair): HTMLElement {
    const item = document.createElement('div')
    item.className = 'tp-cm-conv-item'

    const label = document.createElement('span')
    label.className = 'tp-cm-pair-conv-label'
    label.textContent = pair.convTitle
    label.title = pair.convTitle

    const question = document.createElement('span')
    question.className = 'tp-cm-pair-question'
    question.textContent = pair.question
    question.title = pair.question

    const deleteBtn = document.createElement('button')
    deleteBtn.className = 'tp-cm-conv-delete'
    deleteBtn.textContent = '✕'
    deleteBtn.title = 'Remove from group'
    deleteBtn.addEventListener('click', async (e) => {
      e.stopPropagation()
      const groups = await getTopicGroups()
      if (groups) {
        const updated = groups
          .map((g) => ({
            ...g,
            pairs: g.pairs.filter(
              (p) => !(p.convId === pair.convId && p.pairIndex === pair.pairIndex),
            ),
          }))
          .filter((g) => g.pairs.length > 0)
        await saveTopicGroups(updated)
        // Rebuild section from storage to avoid race with MutationObserver re-renders
        const existing = document.getElementById(SECTION_ID)
        if (existing) {
          this.isRefreshing = true
          try {
            const newSection = await this.buildSection()
            existing.replaceWith(newSection)
          } finally {
            this.isRefreshing = false
          }
        }
      } else {
        item.remove()
      }
    })

    item.appendChild(label)
    item.appendChild(question)
    item.appendChild(deleteBtn)

    item.addEventListener('click', (e) => {
      e.stopPropagation()
      window.location.href = this.convPath(pair.convId)
    })

    return item
  }

  private toggleScopeMenu(btn: HTMLButtonElement) {
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

    const closeMenu = (e: MouseEvent) => {
      if (!menu.contains(e.target as Node) && e.target !== btn) {
        menu.remove()
        this.scopeMenuVisible = false
        document.removeEventListener('click', closeMenu)
      }
    }
    setTimeout(() => document.addEventListener('click', closeMenu), 0)
  }

  private async runMerge(groupName: string, pairs: QAPair[], btn: HTMLButtonElement) {
    btn.disabled = true
    btn.textContent = 'Opening…'

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'MERGE_TOPIC',
        groupName,
        pairs,
        platform: this.opts.adapter.name,
      } as ContentToBackground)) as BackgroundToContent

      if (response.type === 'TOPIC_MERGED') {
        await addMergedGroup(groupName)
        const convId = response.conversationId
        if (convId === 'new') {
          // ChatGPT merge: primer stored in storage, navigate to new chat for injection
          window.location.href = this.opts.adapter.name === 'chatgpt'
            ? 'https://chatgpt.com/'
            : 'https://claude.ai/new'
        } else {
          window.location.href = this.convPath(convId)
        }
      } else {
        const reason = response.type === 'MERGE_FAILED' ? (response.reason ?? 'unknown error') : 'unknown'
        console.error('[ThreadPlugin] Merge failed:', reason)
        btn.textContent = `✗ ${reason.slice(0, 40)}`
        btn.style.color = '#e55'
        setTimeout(() => {
          btn.textContent = '↗ New Session'
          btn.style.color = ''
          btn.disabled = false
        }, 4000)
      }
    } catch (err) {
      console.error('[ThreadPlugin] Merge error:', err)
      btn.textContent = `✗ ${String(err).slice(0, 40)}`
      btn.style.color = '#e55'
      setTimeout(() => {
        btn.textContent = '↗ New Session'
        btn.style.color = ''
        btn.disabled = false
      }, 4000)
    }
  }

  private async runOrganize(limit: number) {
    const items = this.opts.adapter.getSidebarConversationItems()

    const conversations: Array<{ id: string; title: string }> = []
    const limited = limit > 0 ? items.slice(0, limit) : items
    for (const li of limited) {
      const link = li.querySelector('a[href^="/chat/"], a[href^="/c/"]') as HTMLAnchorElement | null
      if (!link) continue
      const convId = link.getAttribute('href')?.match(/\/(?:chat|c)\/([a-f0-9-]+)/)?.[1]
      if (!convId) continue
      // Try .truncate first (Claude), then any direct text content (ChatGPT)
      const titleEl = link.querySelector('.truncate') ?? link.querySelector('[class*="truncate"]')
      const title = titleEl?.textContent?.trim() ?? link.textContent?.trim() ?? convId.slice(0, 8)
      conversations.push({ id: convId, title })
    }

    if (conversations.length === 0) return

    this.isOrganizing = true
    this.showLoadingState(conversations.length)

    try {
      const response = (await chrome.runtime.sendMessage({
        type: 'ORGANIZE_CONVERSATIONS',
        conversations,
        platform: this.opts.adapter.name,
      } as ContentToBackground)) as BackgroundToContent

      if (response.type === 'CONVERSATIONS_ORGANIZED') {
        await mergeTopicGroups(response.groups)
      }
    } catch (err) {
      console.error('[ThreadPlugin] Organize failed:', err)
    } finally {
      this.isOrganizing = false
      document.getElementById(SECTION_ID)?.remove()
      this.isRefreshing = false
      await this.doRefresh()
    }
  }

  private showLoadingState(convCount: number) {
    const section = document.getElementById(SECTION_ID)
    if (!section) return

    const btn = section.querySelector('.tp-cm-organize-btn') as HTMLButtonElement | null
    if (btn) { btn.textContent = 'Organizing…'; btn.disabled = true }

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
      label.textContent = `Extracting Q&A pairs from ${convCount} conversations…`

      body.appendChild(bar)
      body.appendChild(label)
    }
  }

  clearAndRefresh() {
    document.getElementById(SECTION_ID)?.remove()
    this.refresh()
  }
}
