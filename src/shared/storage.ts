import type { Thread, TopicGroup } from './types'

const THREADS_KEY = 'archived_threads'
const SETTINGS_KEY = 'settings'

export interface Settings {
  threadingEnabled: boolean
}

const defaultSettings: Settings = {
  threadingEnabled: true,
}

export async function getArchivedThreads(): Promise<Thread[]> {
  const result = await chrome.storage.local.get(THREADS_KEY)
  return (result[THREADS_KEY] as Thread[]) ?? []
}

export async function saveArchivedThread(thread: Thread): Promise<void> {
  const threads = await getArchivedThreads()
  threads.unshift({ ...thread, archivedAt: Date.now() })
  await chrome.storage.local.set({ [THREADS_KEY]: threads })
}

export async function deleteArchivedThread(threadId: string): Promise<void> {
  const threads = await getArchivedThreads()
  await chrome.storage.local.set({
    [THREADS_KEY]: threads.filter((t) => t.id !== threadId),
  })
}

export async function getSettings(): Promise<Settings> {
  const result = await chrome.storage.local.get(SETTINGS_KEY)
  return { ...defaultSettings, ...(result[SETTINGS_KEY] as Partial<Settings>) }
}

export async function saveSettings(settings: Partial<Settings>): Promise<void> {
  const current = await getSettings()
  await chrome.storage.local.set({ [SETTINGS_KEY]: { ...current, ...settings } })
}

const PENDING_INJECT_KEY = 'pending_inject'

export async function setPendingInject(thread: Thread): Promise<void> {
  await chrome.storage.local.set({ [PENDING_INJECT_KEY]: thread })
}

export async function getPendingInject(): Promise<Thread | null> {
  const result = await chrome.storage.local.get(PENDING_INJECT_KEY)
  return (result[PENDING_INJECT_KEY] as Thread) ?? null
}

export async function clearPendingInject(): Promise<void> {
  await chrome.storage.local.remove(PENDING_INJECT_KEY)
}

export async function getThreadsByConversation(): Promise<Record<string, Thread[]>> {
  const threads = await getArchivedThreads()
  const grouped: Record<string, Thread[]> = {}
  for (const t of threads) {
    const id = t.conversationId ?? extractConversationId(t.conversationUrl)
    if (id) {
      ;(grouped[id] ??= []).push(t)
    }
  }
  return grouped
}

// Active thread per conversation (persisted so sidebar can show threads for all conversations)
export async function setActiveThread(convId: string, thread: Thread): Promise<void> {
  await chrome.storage.local.set({ [`active_thread:${convId}`]: thread })
}

export async function getActiveThread(convId: string): Promise<Thread | null> {
  const result = await chrome.storage.local.get(`active_thread:${convId}`)
  return (result[`active_thread:${convId}`] as Thread) ?? null
}

export async function clearActiveThread(convId: string): Promise<void> {
  await chrome.storage.local.remove(`active_thread:${convId}`)
}

export async function getAllActiveThreads(): Promise<Record<string, Thread>> {
  const all = await chrome.storage.local.get(null)
  const result: Record<string, Thread> = {}
  for (const [key, value] of Object.entries(all)) {
    if (key.startsWith('active_thread:')) {
      const convId = key.slice('active_thread:'.length)
      result[convId] = value as Thread
    }
  }
  return result
}

function extractConversationId(url: string): string | undefined {
  const match = url.match(/\/chat\/([a-f0-9-]+)/)
  return match?.[1]
}

const GROUPS_KEY = 'topic_groups'

export async function saveTopicGroups(groups: TopicGroup[]): Promise<void> {
  await chrome.storage.local.set({ [GROUPS_KEY]: groups })
}

export async function getTopicGroups(): Promise<TopicGroup[] | null> {
  const result = await chrome.storage.local.get(GROUPS_KEY)
  return (result[GROUPS_KEY] as TopicGroup[]) ?? null
}

export async function clearTopicGroups(): Promise<void> {
  await chrome.storage.local.remove(GROUPS_KEY)
}

const MERGED_GROUPS_KEY = 'merged_groups'

export async function getMergedGroups(): Promise<Set<string>> {
  const result = await chrome.storage.local.get(MERGED_GROUPS_KEY)
  return new Set((result[MERGED_GROUPS_KEY] as string[]) ?? [])
}

export async function addMergedGroup(groupName: string): Promise<void> {
  const merged = await getMergedGroups()
  merged.add(groupName)
  await chrome.storage.local.set({ [MERGED_GROUPS_KEY]: [...merged] })
}

export async function clearMergedGroups(): Promise<void> {
  await chrome.storage.local.remove(MERGED_GROUPS_KEY)
}
