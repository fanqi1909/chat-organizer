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
          const convTitles: Record<string, string> = {}
          for (const c of msg.conversations) convTitles[c.id] = c.title
          const response: BackgroundToContent = { type: 'CONVERSATIONS_ORGANIZED', groups, convTitles }
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
 * Headers required by claude.ai's completion endpoint.
 */
const COMPLETION_HEADERS = {
  'Content-Type': 'application/json',
  'accept': 'text/event-stream',
  'anthropic-client-platform': 'web_claude_ai',
}

/**
 * Read an SSE stream from claude.ai's /completion endpoint and return the full text.
 * Each line is "data: <json>" where json has a "completion" field.
 */
async function readCompletionStream(res: Response): Promise<string> {
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
          const parsed = JSON.parse(raw) as { completion?: string; stop_reason?: string }
          if (parsed.completion) fullText += parsed.completion
        } catch { /* skip malformed lines */ }
      }
    }
  }
  return fullText
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
      headers: COMPLETION_HEADERS,
      credentials: 'include',
      body: JSON.stringify({
        prompt,
        model: 'claude-sonnet-4-6',
        max_tokens_to_sample: 100,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        parent_message_uuid: '00000000-0000-4000-8000-000000000000',
        rendering_mode: 'raw',
        attachments: [],
        files: [],
      }),
    },
  )

  if (!msgRes.ok) throw new Error(`Classification API failed: ${msgRes.status}`)

  const text = await readCompletionStream(msgRes)

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
    headers: COMPLETION_HEADERS,
    credentials: 'include',
    body: JSON.stringify({
      prompt,
      model: 'claude-sonnet-4-6',
      max_tokens_to_sample: 150,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      parent_message_uuid: '00000000-0000-4000-8000-000000000000',
      rendering_mode: 'raw',
      attachments: [],
      files: [],
    }),
  })
  if (!msgRes.ok) throw new Error(`Restore completion failed: ${msgRes.status}`)

  return conv.uuid
}

/**
 * Fetch the actual human messages from a claude.ai conversation.
 * Returns up to 6 human message texts, each truncated to 300 chars.
 */
async function fetchConversationMessages(
  convId: string,
  baseUrl: string,
): Promise<string[]> {
  try {
    const res = await fetch(`${baseUrl}/chat_conversations/${convId}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    const data = (await res.json()) as {
      chat_messages?: Array<{
        sender?: string
        role?: string
        text?: string
        content?: Array<{ type: string; text: string }>
      }>
    }
    const messages = data.chat_messages ?? []
    const humanTexts = messages
      .filter((m) => { const s = (m.sender ?? m.role ?? '').toLowerCase(); return s === 'human' || s === 'user' })
      .slice(0, 6)
      .map((m) => {
        let text = m.text ?? m.content?.find((c) => c.type === 'text')?.text ?? ''
        text = text.trim()
        // Extract innermost real topic from (possibly nested) thread-restore messages like:
        // "[Continuing from archived thread: "[Continuing from archived thread: "女儿磨磨蹭蹭弹琴怎么办"]"]"
        // Strategy: find the innermost quoted string that contains no brackets or quotes
        if (text.includes('Continuing from archived thread')) {
          const inner = text.match(/"([^"\[\]]{3,})"/)
          text = inner ? inner[1] : ''
        }
        return text.slice(0, 300)
      })
      .filter(Boolean)
    console.log(`[ThreadPlugin] fetchMessages ${convId}: total=${messages.length} human=${humanTexts.length}`, humanTexts[0]?.slice(0, 80))
    return humanTexts
  } catch (e) {
    console.error(`[ThreadPlugin] fetchMessages ${convId} failed:`, e)
    return []
  }
}

/**
 * Use claude.ai's internal API to group conversations by topic.
 * Fetches real message content for each conversation, then extracts and merges topics.
 * A single conversation can appear in multiple topic groups.
 */
async function organizeConversations(
  conversations: Array<{ id: string; title: string }>,
): Promise<ConversationGroup[]> {
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })

  const orgId = cookie?.value
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  // Fetch real messages for each conversation in parallel
  const convsWithContent = await Promise.all(
    conversations.map(async (c) => {
      const messages = await fetchConversationMessages(c.id, baseUrl)
      return { ...c, messages }
    }),
  )

  const convList = convsWithContent
    .map((c) => {
      const content =
        c.messages.length > 0
          ? c.messages.map((m, i) => `  [${i + 1}] "${m}"`).join('\n')
          : `  (no content retrieved)`
      return `conv_id: "${c.id}"\ntitle: "${c.title}"\nmessages:\n${content}`
    })
    .join('\n\n---\n\n')

  const prompt = `You are organizing conversations by topic. Each conversation may cover multiple topics.

Your task:
1. For each conversation, identify all distinct topics it covers
2. Merge similar topics across conversations into unified topic groups
3. A conversation should appear in EVERY topic group it is relevant to
4. Use the same language as the conversation content for topic names
5. Topic names should be concise (2-5 words)
6. Create 2-8 topic groups total; put uncategorized conversations in "Other"

Return ONLY valid JSON, no explanation:
{"groups": [{"name": "Topic Name", "ids": ["conv_id1", "conv_id2"]}]}

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
    headers: COMPLETION_HEADERS,
    credentials: 'include',
    body: JSON.stringify({
      prompt,
      model: 'claude-sonnet-4-6',
      max_tokens_to_sample: 1000,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      parent_message_uuid: '00000000-0000-4000-8000-000000000000',
      rendering_mode: 'raw',
      attachments: [],
      files: [],
    }),
  })
  if (!msgRes.ok) throw new Error(`Organize API failed: ${msgRes.status}`)

  const text = await readCompletionStream(msgRes)
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
