import type { ContentToBackground, BackgroundToContent, Message, Thread, ConversationGroup } from '../shared/types'

/**
 * Background service worker.
 *
 * Handles topic detection by calling Claude's API using the user's active
 * session cookie from claude.ai — no API key required.
 */

// Keep a rolling history per tab to avoid re-sending everything
const tabHistory = new Map<number, Message[]>()

chrome.runtime.onMessage.addListener(
  (msg: ContentToBackground, sender, sendResponse) => {
    if (msg.type === 'RESTORE_THREAD') {
      restoreThread(msg.thread)
        .then((conversationId) => {
          const response: BackgroundToContent = { type: 'THREAD_RESTORED', conversationId }
          sendResponse(response)
        })
        .catch((err) => {
          console.error('[ThreadPlugin] Thread restore failed:', err)
          const response: BackgroundToContent = { type: 'THREAD_RESTORE_FAILED' }
          sendResponse(response)
        })
      return true
    }

    if (msg.type === 'ORGANIZE_CONVERSATIONS') {
      organizeConversations(msg.conversations)
        .then((groups) => {
          const response: BackgroundToContent = { type: 'CONVERSATIONS_ORGANIZED', groups }
          sendResponse(response)
        })
        .catch((err) => {
          console.error('[ThreadPlugin] Organize failed:', err)
          const response: BackgroundToContent = { type: 'ORGANIZE_FAILED' }
          sendResponse(response)
        })
      return true
    }

    if (msg.type === 'NEW_MESSAGE') {
      const tabId = sender.tab?.id
      if (tabId === undefined) return

      tabHistory.set(tabId, msg.history)

      detectTopic(msg.message, msg.history)
        .then((decision) => {
          const response: BackgroundToContent = {
            type: 'THREAD_DECISION',
            newThread: decision.newThread,
            title: decision.title,
          }
          sendResponse(response)
        })
        .catch((err) => {
          console.error('[ThreadPlugin] Topic detection failed:', err)
          // Fallback: keep same thread
          const response: BackgroundToContent = {
            type: 'THREAD_DECISION',
            newThread: false,
            title: '',
          }
          sendResponse(response)
        })

      // Return true to indicate we will respond asynchronously
      return true
    }
  },
)

async function detectTopic(
  newMessage: Message,
  history: Message[],
): Promise<{ newThread: boolean; title: string }> {
  // Get the claude.ai session cookie
  const cookie = await chrome.cookies.get({
    url: 'https://claude.ai',
    name: 'lastActiveOrg',
  })

  // Try to get session token
  const sessionCookie = await chrome.cookies.get({
    url: 'https://claude.ai',
    name: '__Secure-next-auth.session-token',
  })

  if (!sessionCookie) {
    console.warn('[ThreadPlugin] No session cookie found, using heuristic detection')
    return heuristicDetect(newMessage, history)
  }

  const orgId = cookie?.value

  try {
    return await apiDetect(newMessage, history, sessionCookie.value, orgId)
  } catch {
    // Fallback to heuristic if API call fails
    return heuristicDetect(newMessage, history)
  }
}

/**
 * Call claude.ai's internal API to classify the new message.
 * Creates a short, throwaway conversation just for classification.
 */
async function apiDetect(
  newMessage: Message,
  history: Message[],
  _sessionToken: string,
  orgId: string | undefined,
): Promise<{ newThread: boolean; title: string }> {
  // Build a short context from recent messages (last 6 messages max)
  const recentHistory = history.slice(-6)
  const contextText = recentHistory
    .map((m) => `${m.role === 'human' ? 'User' : 'Assistant'}: ${m.text.slice(0, 200)}`)
    .join('\n')

  const prompt = `You are a conversation analyst. Given the conversation history below and a new assistant message, determine if the new message represents a NEW topic/thread or continues the SAME topic.

Conversation history:
${contextText}

New assistant message: "${newMessage.text.slice(0, 300)}"

Respond with ONLY valid JSON in this exact format:
{"newThread": true/false, "title": "short topic title if new thread, else empty string"}`

  // claude.ai internal API endpoint
  // The orgId is read from the 'lastActiveOrg' cookie
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  // Create a new temporary conversation for classification
  const convRes = await fetch(`${baseUrl}/chat_conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: '' }),
  })

  if (!convRes.ok) throw new Error(`Failed to create conversation: ${convRes.status}`)
  const conv = (await convRes.json()) as { uuid: string }

  // Send the classification message
  const msgRes = await fetch(
    `${baseUrl}/chat_conversations/${conv.uuid}/completion`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        prompt,
        model: 'claude-3-5-haiku-20241022',
        max_tokens_to_sample: 100,
        stream: false,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      }),
    },
  )

  if (!msgRes.ok) throw new Error(`Classification API failed: ${msgRes.status}`)

  const data = (await msgRes.json()) as { completion?: string; content?: Array<{text: string}> }
  const text = data.completion ?? data.content?.[0]?.text ?? ''

  // If response is empty, throw so caller falls back to heuristic
  if (!text) throw new Error('Empty response from classification API')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON found in classification response')

  const parsed = JSON.parse(jsonMatch[0]) as { newThread?: boolean; title?: string }
  return {
    newThread: parsed.newThread ?? false,
    title: parsed.title ?? '',
  }
}

/**
 * Create a real claude.ai conversation pre-loaded with thread history.
 * Returns the new conversation UUID so the tab can navigate directly to it.
 */
async function restoreThread(thread: Thread): Promise<string> {
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })
  const sessionCookie = await chrome.cookies.get({
    url: 'https://claude.ai',
    name: '__Secure-next-auth.session-token',
  })
  if (!sessionCookie) throw new Error('No session cookie')

  const orgId = cookie?.value
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  // Create conversation named after the thread
  const convRes = await fetch(`${baseUrl}/chat_conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: thread.title }),
  })
  if (!convRes.ok) throw new Error(`Failed to create conversation: ${convRes.status}`)
  const conv = (await convRes.json()) as { uuid: string }

  // Build history text (truncate long messages to stay within token limits)
  const historyText = thread.messages
    .map((m) => `${m.role === 'human' ? 'User' : 'Claude'}: ${m.text.slice(0, 500)}`)
    .join('\n\n')

  const prompt = `[Restoring saved thread: "${thread.title}"]\n\nHere is our previous conversation:\n\n${historyText}\n\n---\nThis context has been restored. Briefly acknowledge in one sentence that you remember this conversation, then wait for my next message.`

  // Send the restore message and wait for Claude's acknowledgment
  const msgRes = await fetch(`${baseUrl}/chat_conversations/${conv.uuid}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      prompt,
      model: 'claude-3-5-haiku-20241022',
      max_tokens_to_sample: 150,
      stream: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  })
  if (!msgRes.ok) throw new Error(`Restore completion failed: ${msgRes.status}`)

  return conv.uuid
}

/**
 * Use claude.ai's internal API to group conversations by topic.
 */
async function organizeConversations(
  conversations: Array<{ id: string; title: string; preview: string }>,
): Promise<ConversationGroup[]> {
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })
  const sessionCookie = await chrome.cookies.get({
    url: 'https://claude.ai',
    name: '__Secure-next-auth.session-token',
  })
  if (!sessionCookie) throw new Error('No session cookie')

  const orgId = cookie?.value
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  const convList = conversations
    .map((c) => `- id: "${c.id}", title: "${c.title}", preview: "${c.preview.slice(0, 100)}"`)
    .join('\n')

  const prompt = `Group these conversations by topic. Create 2-6 meaningful topic groups. Ungrouped conversations (if any) go into a group called "Other".

Return ONLY valid JSON, no explanation:
{"groups": [{"name": "Topic Name", "ids": ["uuid1", "uuid2"]}]}

Conversations:
${convList}`

  // Create throwaway conversation for classification
  const convRes = await fetch(`${baseUrl}/chat_conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: '' }),
  })
  if (!convRes.ok) throw new Error(`Failed to create conversation: ${convRes.status}`)
  const conv = (await convRes.json()) as { uuid: string }

  const msgRes = await fetch(`${baseUrl}/chat_conversations/${conv.uuid}/completion`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({
      prompt,
      model: 'claude-3-5-haiku-20241022',
      max_tokens_to_sample: 500,
      stream: false,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }),
  })
  if (!msgRes.ok) throw new Error(`Organize API failed: ${msgRes.status}`)

  const data = (await msgRes.json()) as { completion?: string; content?: Array<{ text: string }> }
  const text = data.completion ?? data.content?.[0]?.text ?? ''
  if (!text) throw new Error('Empty response from organize API')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in organize response')

  const parsed = JSON.parse(jsonMatch[0]) as { groups?: ConversationGroup[] }
  return parsed.groups ?? []
}

/**
 * Tokenize text for overlap comparison.
 * - Latin: extracts words of length > 2
 * - CJK (Chinese/Japanese/Korean): extracts character bigrams for better semantic discrimination
 */
function tokenize(text: string): string[] {
  const tokens: string[] = []
  const lower = text.toLowerCase()
  const cjkRegex = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/

  let latinWord = ''
  const chars = [...lower] // handle surrogate pairs
  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i]
    if (cjkRegex.test(ch)) {
      if (latinWord.length > 2) { tokens.push(latinWord); latinWord = '' }
      // Add single char and bigram with next CJK char
      tokens.push(ch)
      if (i + 1 < chars.length && cjkRegex.test(chars[i + 1])) {
        tokens.push(ch + chars[i + 1])
      }
    } else if (/[a-z0-9]/.test(ch)) {
      latinWord += ch
    } else {
      if (latinWord.length > 2) { tokens.push(latinWord); latinWord = '' }
    }
  }
  if (latinWord.length > 2) tokens.push(latinWord)
  return tokens
}

/**
 * Lightweight heuristic fallback when API is unavailable.
 * Uses explicit transition keywords AND word-overlap similarity to detect topic changes.
 */
function heuristicDetect(
  _newMessage: Message,
  history: Message[],
): { newThread: boolean; title: string } {
  // First message — let content/index.ts handle it (starts thread on first message)
  if (history.length < 2) return { newThread: false, title: '' }

  // Explicit transition phrases (any language)
  const transitions = [
    'by the way', 'btw', 'changing topic', 'different question',
    'unrelated', 'another thing', 'switching to', 'new topic',
    'on another note', 'separate question',
    '顺便', '换个话题', '另外', '不相关', '新话题', '换个问题',
  ]
  const lastHuman = [...history].reverse().find((m) => m.role === 'human')
  const humanText = (lastHuman?.text ?? '').toLowerCase()
  if (transitions.some((t) => humanText.includes(t))) {
    return { newThread: true, title: '' }
  }

  // Token-overlap similarity: compare last human message with earlier context
  // Handles both Latin (word-based) and CJK (character bigram-based)
  const recentMessages = history.slice(-6, -1) // last 5 before current
  if (recentMessages.length < 3) return { newThread: false, title: '' }

  const contextTokens = new Set(
    tokenize(recentMessages.map((m) => m.text).join(' '))
  )
  const newTokens = tokenize(humanText)
  if (newTokens.length === 0) return { newThread: false, title: '' }

  const overlap = newTokens.filter((t) => contextTokens.has(t)).length
  const similarity = overlap / newTokens.length

  // Less than 20% token overlap → likely a new topic
  return { newThread: similarity < 0.2, title: '' }
}
