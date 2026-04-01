import type { ContentToBackground, BackgroundToContent, Message, Thread, TopicGroup, QAPair } from '../shared/types'
import { getTopicGroups } from '../shared/storage'
import * as chatgptApi from './platforms/chatgpt-api'

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
      organizeConversations(msg.conversations, msg.platform)
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

    if (msg.type === 'MERGE_TOPIC') {
      mergeTopicGroup(msg.groupName, msg.pairs, msg.platform)
        .then((conversationId) => {
          const response: BackgroundToContent = { type: 'TOPIC_MERGED', conversationId }
          sendResponse(response)
        })
        .catch((err) => {
          console.error('[ThreadPlugin] Merge failed:', err)
          const response: BackgroundToContent = { type: 'MERGE_FAILED', reason: String(err) }
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
 * Merge selected Q&A pairs from one or more conversations into a new session.
 * Re-fetches full message text (up to 600/1000 chars) for richer context,
 * then creates a named conversation and sends a formatted history primer.
 * Returns the new conversation UUID.
 */
async function mergeTopicGroup(groupName: string, pairs: QAPair[], platform = 'claude'): Promise<string> {
  // Build primer from Q&A pairs
  interface FullPair { question: string; answer: string }
  const sections: Array<{ convTitle: string; fullPairs: FullPair[] }> = []

  // Group requested pairIndexes by convId so we fetch each conversation once
  const pairsByConv = new Map<string, { convTitle: string; indexes: Set<number> }>()
  for (const pair of pairs) {
    if (!pairsByConv.has(pair.convId)) {
      pairsByConv.set(pair.convId, { convTitle: pair.convTitle, indexes: new Set() })
    }
    pairsByConv.get(pair.convId)!.indexes.add(pair.pairIndex)
  }

  if (platform === 'chatgpt') {
    // Fetch full text via ChatGPT API
    for (const [convId, { convTitle, indexes }] of pairsByConv) {
      try {
        const messages = await chatgptApi.fetchConversationMessages(convId)
        const fullPairs: FullPair[] = []
        let pairIndex = 0
        for (let i = 0; i < messages.length - 1; i++) {
          const m = messages[i]
          const next = messages[i + 1]
          if (m.role === 'user' && next.role === 'assistant') {
            if (indexes.has(pairIndex)) {
              const q = m.text.slice(0, 600)
              const a = next.text.slice(0, 1000)
              if (q) fullPairs.push({ question: q, answer: a })
            }
            pairIndex++
          }
        }
        if (fullPairs.length > 0) sections.push({ convTitle, fullPairs })
      } catch {
        // Skip conversations that fail to fetch
      }
    }

    if (sections.length === 0) throw new Error('No content to merge')

    const primerPairs = sections
      .flatMap(({ fullPairs }) =>
        fullPairs.map((p) => `• ${p.question.slice(0, 120)}\n  → ${p.answer.slice(0, 200)}`)
      )
      .join('\n\n')

    const primer =
      `[Continuing: "${groupName}"]\n\n` +
      `Here's what we've discussed on this topic:\n\n` +
      `${primerPairs}\n\n` +
      `---\nPlease acknowledge the above context, then ask what I'd like to explore next.`

    // ChatGPT write API is blocked by Turnstile in the service worker.
    // Store the primer in storage; the content script will inject it on the next new-chat page.
    await chrome.storage.local.set({ pending_chatgpt_merge: primer })
    return 'new'
  }

  // Claude path
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })
  const orgId = cookie?.value
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  for (const [convId, { convTitle, indexes }] of pairsByConv) {
    try {
      const res = await fetch(`${baseUrl}/chat_conversations/${convId}`, {
        credentials: 'include',
      })
      if (!res.ok) continue
      const data = (await res.json()) as { chat_messages?: RawMessage[] }
      const messages = data.chat_messages ?? []

      const fullPairs: FullPair[] = []
      let pairIndex = 0
      for (let i = 0; i < messages.length - 1; i++) {
        const m = messages[i]
        const next = messages[i + 1]
        const sender = (m.sender ?? m.role ?? '').toLowerCase()
        const nextSender = (next.sender ?? next.role ?? '').toLowerCase()
        if ((sender === 'human' || sender === 'user') && nextSender === 'assistant') {
          if (indexes.has(pairIndex)) {
            const q = extractMessageText(m).slice(0, 600)
            const a = extractMessageText(next).slice(0, 1000)
            if (q) fullPairs.push({ question: q, answer: a })
          }
          pairIndex++
        }
      }
      if (fullPairs.length > 0) sections.push({ convTitle, fullPairs })
    } catch {
      // Skip conversations that fail to fetch
    }
  }

  if (sections.length === 0) throw new Error('No content to merge')

  // Build a concise primer directly from Q&A pairs — no extra API call needed
  const primerPairs = sections
    .flatMap(({ fullPairs }) =>
      fullPairs.map((p) => `• ${p.question.slice(0, 120)}\n  → ${p.answer.slice(0, 200)}`)
    )
    .join('\n\n')

  const primer =
    `[Continuing: "${groupName}"]\n\n` +
    `Here's what we've discussed on this topic:\n\n` +
    `${primerPairs}\n\n` +
    `You're up to date on the above. What would you like to explore next?`

  const convRes = await fetch(`${baseUrl}/chat_conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name: groupName }),
  })
  if (!convRes.ok) throw new Error(`Failed to create conversation: ${convRes.status}`)
  const conv = (await convRes.json()) as { uuid: string }

  const msgRes = await fetch(`${baseUrl}/chat_conversations/${conv.uuid}/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'accept': 'text/event-stream',
      'anthropic-client-platform': 'web_claude_ai',
    },
    credentials: 'include',
    body: JSON.stringify({
      prompt: primer,
      model: 'claude-sonnet-4-6',
      max_tokens_to_sample: 200,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      parent_message_uuid: '00000000-0000-4000-8000-000000000000',
      rendering_mode: 'raw',
      attachments: [],
      files: [],
    }),
  })
  if (!msgRes.ok) throw new Error(`Merge completion failed: ${msgRes.status}`)

  await readCompletionStream(msgRes)
  return conv.uuid
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

type RawMessage = {
  sender?: string
  role?: string
  text?: string
  content?: Array<{ type: string; text: string }>
}

function extractMessageText(m: RawMessage): string {
  let text = m.text ?? m.content?.find((c) => c.type === 'text')?.text ?? ''
  // Strip nested restore messages to get the real content
  if (text.includes('Continuing from archived thread')) {
    const inner = text.match(/"([^"\[\]]{3,})"/)
    text = inner ? inner[1] : ''
  }
  return text.trim()
}

/**
 * Fetch Q&A pairs from a claude.ai conversation.
 * Returns up to 8 human→assistant pairs, each question truncated to 150 chars.
 */
async function fetchQAPairs(
  convId: string,
  baseUrl: string,
): Promise<Array<{ question: string; answer: string; pairIndex: number }>> {
  try {
    const res = await fetch(`${baseUrl}/chat_conversations/${convId}`, {
      credentials: 'include',
    })
    if (!res.ok) return []
    const data = (await res.json()) as { chat_messages?: RawMessage[] }
    const messages = data.chat_messages ?? []
    const pairs: Array<{ question: string; answer: string; pairIndex: number }> = []
    let pairIndex = 0
    for (let i = 0; i < messages.length - 1; i++) {
      const m = messages[i]
      const next = messages[i + 1]
      const sender = (m.sender ?? m.role ?? '').toLowerCase()
      const nextSender = (next.sender ?? next.role ?? '').toLowerCase()
      if ((sender === 'human' || sender === 'user') && nextSender === 'assistant') {
        const q = extractMessageText(m).slice(0, 150)
        const a = extractMessageText(next).slice(0, 100)
        if (q) pairs.push({ question: q, answer: a, pairIndex })
        pairIndex++ // always increment to stay in sync with mergeTopicGroup's counter
      }
    }
    return pairs.slice(0, 8)
  } catch {
    return []
  }
}

/**
 * Read an SSE stream from claude.ai's completion endpoint and return the full text.
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
          const parsed = JSON.parse(raw) as { completion?: string }
          if (parsed.completion) fullText += parsed.completion
        } catch { /* ignore parse errors */ }
      }
    }
  }
  return fullText
}

/**
 * Use claude.ai's internal API to group Q&A pairs by topic.
 * Fetches message pairs from each conversation, then groups them semantically.
 * A single conversation's pairs can appear in multiple topic groups.
 */
async function organizeConversations(
  conversations: Array<{ id: string; title: string }>,
  platform = 'claude',
): Promise<TopicGroup[]> {
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })
  const orgId = cookie?.value
  const baseUrl = orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'

  // Fetch Q&A pairs for all conversations in parallel
  const convsWithPairs = await Promise.all(
    conversations.map(async (c) => {
      const pairs = platform === 'chatgpt'
        ? await chatgptApi.fetchQAPairs(c.id)
        : await fetchQAPairs(c.id, baseUrl)
      return { ...c, pairs }
    }),
  )

  // Build flat list of all pairs with compact IDs
  const allPairs: PairWithId[] = []
  for (const conv of convsWithPairs) {
    for (const p of conv.pairs) {
      allPairs.push({
        pairId: `${conv.id}_${p.pairIndex}`,
        convId: conv.id,
        convTitle: conv.title,
        question: p.question,
        answer: p.answer,
        pairIndex: p.pairIndex,
      })
    }
  }

  // Cap total pairs to stay within token budget (~300 pairs ≈ 21k tokens)
  const cappedPairs = allPairs.slice(0, 300)
  if (cappedPairs.length === 0) return []

  const pairList = cappedPairs
    .map((p) => `pair_id: "${p.pairId}"\nQ: "${p.question}"\nA: "${p.answer}"`)
    .join('\n\n')

  // Fetch existing group names so the AI can reuse them (enables exact-match merge)
  const existingGroups = await getTopicGroups()
  const existingNames = (existingGroups ?? []).map((g) => g.name)
  const existingNamesSection = existingNames.length > 0
    ? `\nExisting group names (reuse EXACTLY if the topic matches — do not paraphrase):\n${existingNames.map((n) => `- "${n}"`).join('\n')}\n`
    : ''

  const prompt = `You are organizing Q&A pairs from conversations by topic.

Each pair has a pair_id (format: "convId_index"), Q (user question), A (assistant answer).
${existingNamesSection}
Rules:
1. Group pairs by their PRIMARY topic. Pairs that don't clearly fit any topic go into a group named "Other".
2. IMPORTANT: Pairs from the SAME conversation must be split into different groups if they cover different topics. Do NOT group all pairs from one conversation together.
3. A pair can appear in multiple groups only if it genuinely covers two clearly distinct topics.
4. Topic names: 2-5 words, same language as content.
5. Merge similar topics into one group rather than creating many small groups.
6. Return ONLY valid JSON, no explanation:
{"groups": [{"name": "Topic Name", "pairs": ["id1", "id2"]}]}

Q&A Pairs:
${pairList}`

  let text: string

  if (platform === 'chatgpt') {
    // Relay classification through the ChatGPT tab's content script → MAIN world relay.
    // The relay uses cached sentinel tokens (Turnstile, PoW) from ChatGPT's own requests.
    // Falls back to heuristic clustering if no active ChatGPT tab or tokens not cached.
    try {
      const [tab] = await chrome.tabs.query({ url: 'https://chatgpt.com/*' })
      if (!tab?.id) throw new Error('No ChatGPT tab found')

      const result = await chrome.tabs.sendMessage(tab.id, {
        type: 'CLASSIFY_VIA_PAGE',
        prompt,
      }) as { text?: string; error?: string }

      if (result.error) throw new Error(result.error)
      if (!result.text) throw new Error('Empty response from ChatGPT relay')
      text = result.text
    } catch (relayErr) {
      console.warn('[ThreadPlugin] ChatGPT relay failed, falling back to heuristic:', relayErr)
      return heuristicOrganize(cappedPairs)
    }
  } else {
    // Claude path: create throwaway conversation for classification
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
      headers: {
        'Content-Type': 'application/json',
        'accept': 'text/event-stream',
        'anthropic-client-platform': 'web_claude_ai',
      },
      credentials: 'include',
      body: JSON.stringify({
        prompt,
        model: 'claude-sonnet-4-6',
        max_tokens_to_sample: 2000,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        parent_message_uuid: '00000000-0000-4000-8000-000000000000',
        rendering_mode: 'raw',
        attachments: [],
        files: [],
      }),
    })
    if (!msgRes.ok) throw new Error(`Organize API failed: ${msgRes.status}`)
    text = await readCompletionStream(msgRes)
  }
  if (!text) throw new Error('Empty response from organize API')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in organize response')

  // Build pair lookup map for ID → QAPair expansion
  const pairLookup = new Map(cappedPairs.map((p) => [p.pairId, p]))

  const parsed = JSON.parse(jsonMatch[0]) as {
    groups?: Array<{ name: string; pairs: string[] }>
  }

  return (parsed.groups ?? [])
    .map((g) => ({
      name: g.name,
      pairs: g.pairs
        .map((pairId): QAPair | null => {
          const p = pairLookup.get(pairId)
          if (!p) return null
          return { convId: p.convId, convTitle: p.convTitle, question: p.question, pairIndex: p.pairIndex }
        })
        .filter((p): p is QAPair => p !== null),
    }))
    .filter((g) => g.pairs.length > 0)
}

type PairWithId = {
  pairId: string
  convId: string
  convTitle: string
  question: string
  answer: string
  pairIndex: number
}

/**
 * Heuristic topic clustering for ChatGPT (no API required).
 *
 * Strategy: keyword-based grouping on question text only.
 * 1. Extract "topic tokens" from each question (non-stopword, length ≥ 4).
 * 2. Count how often each token appears across all questions.
 * 3. Each pair's "primary topic token" = the most globally-frequent topic token
 *    found in its question. This pulls all "github" questions into one group, etc.
 * 4. Pairs sharing no frequent token fall into "Other".
 */
function heuristicOrganize(allPairs: PairWithId[]): TopicGroup[] {
  const STOP = new Set([
    'the', 'and', 'for', 'what', 'how', 'can', 'this', 'that', 'with',
    'from', 'are', 'you', 'have', 'use', 'using', 'need', 'want', 'get',
    'your', 'not', 'but', 'its', 'was', 'will', 'when', 'out', 'also',
    'just', 'more', 'some', 'been', 'they', 'them', 'then', 'than',
    'into', 'like', 'make', 'does', 'did', 'any', 'all', 'has', 'had',
  ])

  // Step 1: collect question key tokens per pair.
  // tokenize() already yields:
  //   - Latin words of length ≥ 3
  //   - CJK single chars (length 1) and bigrams (length 2)
  // Keep length ≥ 2 so Chinese bigrams and short English words like "doh" are included.
  const pairKeys: Array<string[]> = allPairs.map((p) =>
    tokenize(p.question).filter((t) => !STOP.has(t) && t.length >= 2)
  )

  // Step 2: global token frequency across all questions
  const globalFreq = new Map<string, number>()
  for (const keys of pairKeys) {
    for (const t of keys) {
      globalFreq.set(t, (globalFreq.get(t) ?? 0) + 1)
    }
  }

  // Step 3: assign each pair to its most globally-frequent key token
  // (ties broken by token alphabetical order for stability)
  const groups = new Map<string, PairWithId[]>()
  for (let i = 0; i < allPairs.length; i++) {
    const keys = pairKeys[i]
    // Only consider tokens that appear in ≥2 questions (otherwise too unique to group)
    const candidates = keys.filter((t) => (globalFreq.get(t) ?? 0) >= 2)
    let best = candidates.length > 0
      ? candidates.reduce((a, b) => (globalFreq.get(b)! > globalFreq.get(a)! ? b : a))
      : null

    const label = best ?? 'Other'
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(allPairs[i])
  }

  // Step 4: build result, move singletons without a real label into "Other"
  const result: TopicGroup[] = []
  const otherPairs: PairWithId[] = []

  for (const [label, pairs] of groups) {
    if (label === 'Other') {
      otherPairs.push(...pairs)
      continue
    }
    // Build a 2-3 word group name: take the label plus its most co-occurring peer token
    const peerFreq = new Map<string, number>()
    for (const p of pairs) {
      const idx = allPairs.indexOf(p)
      for (const t of pairKeys[idx]) {
        if (t !== label && !STOP.has(t) && t.length >= 2) {
          peerFreq.set(t, (peerFreq.get(t) ?? 0) + 1)
        }
      }
    }
    const topPeer = [...peerFreq.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    const name = topPeer && peerFreq.get(topPeer)! >= 2 ? `${label} ${topPeer}` : label

    result.push({
      name,
      pairs: pairs.map((p) => ({
        convId: p.convId,
        convTitle: p.convTitle,
        question: p.question,
        pairIndex: p.pairIndex,
      })),
    })
  }

  if (otherPairs.length > 0) {
    result.push({
      name: 'Other',
      pairs: otherPairs.map((p) => ({
        convId: p.convId,
        convTitle: p.convTitle,
        question: p.question,
        pairIndex: p.pairIndex,
      })),
    })
  }

  return result.filter((g) => g.pairs.length > 0)
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
