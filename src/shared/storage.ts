import type { Thread } from './types'

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
