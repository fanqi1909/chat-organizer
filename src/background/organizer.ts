import type { TopicGroup, QAPair } from '../shared/types'
import { getOrgId, buildBaseUrl, createConversation, sendCompletion } from './platforms/claude-api'
import * as chatgptApi from './platforms/chatgpt-api'
import { tokenize } from './topic-detector'

type RawMessage = {
  sender?: string
  role?: string
  text?: string
  content?: Array<{ type: string; text: string }>
}

interface PairWithId {
  pairId: string
  convId: string
  convTitle: string
  question: string
  answer: string
  pairIndex: number
}

function extractMessageText(m: RawMessage): string {
  let text = m.text ?? m.content?.find((c) => c.type === 'text')?.text ?? ''
  if (text.includes('Continuing from archived thread')) {
    const inner = text.match(/"([^"\[\]]{3,})"/)
    text = inner ? inner[1] : ''
  }
  return text.trim()
}

/**
 * Fetch Q&A pairs from a conversation.
 * Dispatches to the correct platform API based on the platform param.
 * Returns up to 8 human→assistant pairs, each question truncated to 150 chars.
 */
export async function fetchQAPairs(
  convId: string,
  baseUrl: string,
  platform = 'claude',
): Promise<Array<{ question: string; answer: string; pairIndex: number }>> {
  if (platform === 'chatgpt') {
    return chatgptApi.fetchQAPairs(convId)
  }
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
 * Group pairs by their AI-assigned labels.
 * Each pair appears in exactly one group.
 */
export function buildGroups(
  labels: Record<string, string>,
  allPairs: PairWithId[],
): TopicGroup[] {
  const groups = new Map<string, QAPair[]>()
  for (const p of allPairs) {
    const label = labels[p.pairId]?.trim()
    if (!label) continue
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push({
      convId: p.convId,
      convTitle: p.convTitle,
      question: p.question,
      pairIndex: p.pairIndex,
    })
  }
  return Array.from(groups.entries()).map(([name, pairs]) => ({ name, pairs }))
}

/**
 * Jaccard similarity between the token sets of two strings.
 * Uses the existing CJK-aware tokenizer.
 */
export function jaccardSimilarity(a: string, b: string): number {
  const setA = new Set(tokenize(a))
  const setB = new Set(tokenize(b))
  if (setA.size === 0 && setB.size === 0) return 1
  if (setA.size === 0 || setB.size === 0) return 0
  const intersection = [...setA].filter((t) => setB.has(t)).length
  return intersection / (setA.size + setB.size - intersection)
}

/**
 * Merge topic groups whose names are similar enough (Jaccard ≥ threshold).
 * Iteratively merges until no more pairs are found.
 */
export function mergeByNameSimilarity(
  groups: TopicGroup[],
  threshold = 0.4,
): TopicGroup[] {
  let current = groups.map((g) => ({ ...g, pairs: [...g.pairs] }))
  let changed = true
  while (changed) {
    changed = false
    outer: for (let i = 0; i < current.length; i++) {
      for (let j = i + 1; j < current.length; j++) {
        if (jaccardSimilarity(current[i].name, current[j].name) >= threshold) {
          // Merge j into i, keep i's name (first encountered)
          current[i].pairs.push(...current[j].pairs)
          current.splice(j, 1)
          changed = true
          break outer
        }
      }
    }
  }
  return current
}

/**
 * Organise conversations by topic.
 *
 * Two-phase approach:
 *  1. AI assigns ONE topic label per Q&A pair (simple classification, fewer tokens)
 *  2. Code groups pairs by label, then merges similar-named groups algorithmically
 *
 * This keeps AI in the role it's good at (semantic labelling) while making
 * grouping and deduplication deterministic and testable.
 */
export async function organizeConversations(
  conversations: Array<{ id: string; title: string }>,
  platform = 'claude',
): Promise<TopicGroup[]> {
  const orgId = await getOrgId()
  const baseUrl = buildBaseUrl(orgId)

  const convsWithPairs = await Promise.all(
    conversations.map(async (c) => {
      const pairs = await fetchQAPairs(c.id, baseUrl, platform)
      return { ...c, pairs }
    }),
  )

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

  const cappedPairs = allPairs.slice(0, 300)
  if (cappedPairs.length === 0) return []

  // Phase 1: ask AI to assign ONE broad label per pair
  const pairList = cappedPairs
    .map((p) => `"${p.pairId}": Q: ${p.question}`)
    .join('\n')

  const prompt = `Assign ONE short topic label (2-5 words) to each Q&A pair.

Rules:
- Each pair gets exactly ONE label
- Use broad labels — group related sub-topics together
- Use the same language as the content
- Skip pairs that are trivial greetings or meta-conversation
- Return ONLY valid JSON: {"pair_id": "label", ...}

Pairs:
${pairList}`

  let text: string
  if (platform === 'chatgpt') {
    const result = await chatgptApi.createConversationAndSend(prompt)
    text = result.text
  } else {
    const convUuid = await createConversation(baseUrl)
    text = await sendCompletion(baseUrl, convUuid, prompt)
  }
  if (!text) throw new Error('Empty response from organize API')

  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) throw new Error('No JSON in organize response')

  const labels = JSON.parse(jsonMatch[0]) as Record<string, string>

  // Phase 2: group by label, then merge similar names in code
  const groups = buildGroups(labels, cappedPairs)
  return mergeByNameSimilarity(groups)
}
