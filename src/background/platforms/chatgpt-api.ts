/**
 * ChatGPT (chatgpt.com) internal API helpers.
 * Uses the user's existing browser session — no API key required.
 * Background service worker only.
 */

const BASE_URL = 'https://chatgpt.com/backend-api'

interface AccessTokenCache {
  token: string
  fetchedAt: number
}

let tokenCache: AccessTokenCache | null = null
const TOKEN_TTL_MS = 5 * 60 * 1000 // 5 minutes

/** Fetch the Bearer token from the ChatGPT session endpoint. Cached ~5 min. */
export async function getAccessToken(): Promise<string> {
  const now = Date.now()
  if (tokenCache && now - tokenCache.fetchedAt < TOKEN_TTL_MS) {
    return tokenCache.token
  }

  const res = await fetch('https://chatgpt.com/api/auth/session', {
    credentials: 'include',
  })
  if (!res.ok) throw new Error(`ChatGPT session fetch failed: ${res.status}`)
  const data = (await res.json()) as { accessToken?: string }
  if (!data.accessToken) throw new Error('No accessToken in ChatGPT session response')

  tokenCache = { token: data.accessToken, fetchedAt: now }
  return data.accessToken
}

/**
 * Parse ChatGPT's SSE stream format.
 * Each data line carries a JSON object; `message.content.parts[0]` is the text delta.
 * Returns the final accumulated text.
 */
export async function readChatGPTStream(res: Response): Promise<string> {
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let fullText = ''
  let done = false

  while (!done) {
    const result = await reader.read()
    done = result.done
    if (result.value) {
      const chunk = decoder.decode(result.value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') { done = true; break }
        try {
          const parsed = JSON.parse(raw) as {
            message?: {
              content?: { parts?: string[] }
              status?: string
            }
          }
          // Only capture the final "finished" message to avoid accumulating deltas
          if (
            parsed.message?.status === 'finished_successfully' &&
            parsed.message.content?.parts?.[0]
          ) {
            fullText = parsed.message.content.parts[0]
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }
  return fullText
}

/**
 * Create a new ChatGPT conversation and send a prompt via SSE streaming.
 * Returns { conversationId, text }.
 */
export async function createConversationAndSend(
  prompt: string,
  model = 'gpt-4o-mini',
): Promise<{ conversationId: string; text: string }> {
  const token = await getAccessToken()

  const body = {
    action: 'next',
    messages: [
      {
        id: crypto.randomUUID(),
        author: { role: 'user' },
        content: { content_type: 'text', parts: [prompt] },
      },
    ],
    model,
    timezone_offset_min: new Date().getTimezoneOffset(),
    suggestions: [],
    history_and_training_disabled: false,
    conversation_mode: { kind: 'primary_assistant' },
    force_nulligen: false,
    force_paragen: false,
    force_paragen_model_slug: '',
    force_rate_limit: false,
    reset_rate_limits: false,
    websocket_request_id: crypto.randomUUID(),
  }

  const res = await fetch(`${BASE_URL}/conversation`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  })

  if (!res.ok) throw new Error(`ChatGPT conversation create failed: ${res.status}`)

  // Parse SSE to find conversation_id and final text
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response body')
  const decoder = new TextDecoder()
  let conversationId = ''
  let finalText = ''
  let done = false

  while (!done) {
    const result = await reader.read()
    done = result.done
    if (result.value) {
      const chunk = decoder.decode(result.value, { stream: true })
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue
        const raw = line.slice(6).trim()
        if (raw === '[DONE]') { done = true; break }
        try {
          const parsed = JSON.parse(raw) as {
            conversation_id?: string
            message?: {
              content?: { parts?: string[] }
              status?: string
            }
          }
          if (parsed.conversation_id) conversationId = parsed.conversation_id
          if (
            parsed.message?.status === 'finished_successfully' &&
            parsed.message.content?.parts?.[0]
          ) {
            finalText = parsed.message.content.parts[0]
          }
        } catch { /* ignore parse errors */ }
      }
    }
  }

  if (!conversationId) throw new Error('No conversation_id in ChatGPT SSE response')
  return { conversationId, text: finalText }
}

interface ChatGPTNode {
  id: string
  message: {
    id: string
    author: { role: string }
    content: { parts?: string[] }
    status?: string
  } | null
  parent: string | null
  children: string[]
}

interface ChatGPTConversation {
  mapping: Record<string, ChatGPTNode>
}

/**
 * Fetch a ChatGPT conversation by ID and walk the mapping tree to a linear message list.
 * Returns messages in order: [{role, text}, ...]
 */
export async function fetchConversationMessages(
  convId: string,
): Promise<Array<{ role: string; text: string }>> {
  const token = await getAccessToken()
  const res = await fetch(`${BASE_URL}/conversation/${convId}`, {
    headers: { 'Authorization': `Bearer ${token}` },
    credentials: 'include',
  })
  if (!res.ok) return []

  const data = (await res.json()) as ChatGPTConversation
  const mapping = data.mapping ?? {}

  // Find root node (no parent or parent not in mapping)
  const rootId = Object.keys(mapping).find((id) => {
    const node = mapping[id]
    return !node.parent || !mapping[node.parent]
  })
  if (!rootId) return []

  // Walk the tree: always follow children[0] for linear thread
  const messages: Array<{ role: string; text: string }> = []
  let currentId: string | null = rootId
  while (currentId) {
    const treeNode: ChatGPTNode | undefined = mapping[currentId]
    if (!treeNode) break
    const msg = treeNode.message
    if (msg && msg.content?.parts?.[0] && msg.author.role !== 'system') {
      const text = msg.content.parts[0].trim()
      if (text) {
        messages.push({ role: msg.author.role, text })
      }
    }
    currentId = treeNode.children[0] ?? null
  }

  return messages
}

/**
 * Fetch Q&A pairs from a ChatGPT conversation.
 * Returns up to 8 user→assistant pairs, each question truncated to 150 chars.
 * Same signature as Claude's fetchQAPairs.
 */
export async function fetchQAPairs(
  convId: string,
): Promise<Array<{ question: string; answer: string; pairIndex: number }>> {
  try {
    const messages = await fetchConversationMessages(convId)
    const pairs: Array<{ question: string; answer: string; pairIndex: number }> = []
    let pairIndex = 0

    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i]
      const next = messages[i + 1]
      if (m.role === 'user' && next.role === 'assistant') {
        const q = m.text.slice(0, 150)
        const a = next.text.slice(0, 100)
        if (q) pairs.push({ question: q, answer: a, pairIndex: pairIndex++ })
      }
    }

    return pairs.slice(0, 8)
  } catch {
    return []
  }
}
