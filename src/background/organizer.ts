import type { TopicGroup, QAPair } from '../shared/types'
import { getOrgId, buildBaseUrl, createConversation, sendCompletion } from './platforms/claude-api'

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
export async function fetchQAPairs(
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
        if (q) pairs.push({ question: q, answer: a, pairIndex: pairIndex++ })
      }
    }
    return pairs.slice(0, 8)
  } catch {
    return []
  }
}

/**
 * Use claude.ai's internal API to group Q&A pairs by topic.
 * Fetches message pairs from each conversation, then groups them semantically.
 * A single conversation's pairs can appear in multiple topic groups.
 */
export async function organizeConversations(
  conversations: Array<{ id: string; title: string }>,
): Promise<TopicGroup[]> {
  const orgId = await getOrgId()
  const baseUrl = buildBaseUrl(orgId)

  // Fetch Q&A pairs for all conversations in parallel
  const convsWithPairs = await Promise.all(
    conversations.map(async (c) => {
      const pairs = await fetchQAPairs(c.id, baseUrl)
      return { ...c, pairs }
    }),
  )

  // Build flat list of all pairs with compact IDs
  interface PairWithId {
    pairId: string
    convId: string
    convTitle: string
    question: string
    answer: string
    pairIndex: number
  }
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

  const prompt = `You are organizing Q&A pairs from conversations by topic.

Each pair has a pair_id (format: "convId_index"), Q (user question), A (assistant answer).

Rules:
1. Group ALL pairs by topic — every pair should belong to at least one group
2. A pair can appear in multiple groups if it clearly covers multiple distinct topics
3. Topic names: 2-5 words, same language as content
4. Merge similar topics into one group rather than creating many small groups
5. Return ONLY valid JSON, no explanation:
{"groups": [{"name": "Topic Name", "pairs": ["id1", "id2"]}]}

Q&A Pairs:
${pairList}`

  const convUuid = await createConversation(baseUrl)
  const text = await sendCompletion(baseUrl, convUuid, prompt)
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
