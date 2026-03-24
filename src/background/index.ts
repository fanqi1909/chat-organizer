import type { ContentToBackground, BackgroundToContent, Message } from '../shared/types'

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

  try {
    const parsed = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] ?? '{}') as {
      newThread?: boolean
      title?: string
    }
    return {
      newThread: parsed.newThread ?? false,
      title: parsed.title ?? '',
    }
  } catch {
    return { newThread: false, title: '' }
  }
}

/**
 * Lightweight heuristic fallback when API is unavailable.
 * Detects topic changes based on keyword signals.
 */
function heuristicDetect(
  newMessage: Message,
  history: Message[],
): { newThread: boolean; title: string } {
  if (history.length < 3) return { newThread: false, title: '' }

  const transitions = [
    'by the way',
    'changing topic',
    'different question',
    'unrelated',
    'another thing',
    'switching to',
    'new topic',
    '顺便问一下',
    '换个话题',
    '另外',
  ]

  const lastHuman = [...history].reverse().find((m) => m.role === 'human')
  const text = (lastHuman?.text ?? '').toLowerCase()

  const isNewTopic = transitions.some((t) => text.includes(t))
  return { newThread: isNewTopic, title: '' }
}
