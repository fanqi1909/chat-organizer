import type { Message } from '../shared/types'
import { getOrgId, buildBaseUrl, createConversation, sendCompletion } from './platforms/claude-api'

// Re-export for backwards compatibility with organizer.ts (will be cleaned up in Phase 2)
export { COMPLETION_HEADERS, readCompletionStream } from './platforms/claude-api'

/**
 * Tokenize text for overlap comparison.
 * - Latin: extracts words of length > 2
 * - CJK (Chinese/Japanese/Korean): extracts character bigrams for better semantic discrimination
 */
export function tokenize(text: string): string[] {
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
export function heuristicDetect(
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

/**
 * Call claude.ai's internal API to classify the new message.
 * Creates a short, throwaway conversation just for classification.
 */
export async function apiDetect(
  newMessage: Message,
  history: Message[],
): Promise<{ newThread: boolean; title: string }> {
  const orgId = await getOrgId()
  const baseUrl = buildBaseUrl(orgId)

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

  const convUuid = await createConversation(baseUrl)
  const text = await sendCompletion(baseUrl, convUuid, prompt, 100)

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
 * Top-level topic detection: tries API first, falls back to heuristic.
 */
export async function detectTopic(
  newMessage: Message,
  history: Message[],
): Promise<{ newThread: boolean; title: string }> {
  try {
    return await apiDetect(newMessage, history)
  } catch {
    return heuristicDetect(newMessage, history)
  }
}
