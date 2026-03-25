/**
 * Claude.ai internal API helpers.
 * All interaction with claude.ai's undocumented REST API lives here.
 * Background service worker only — uses chrome.cookies and fetch with credentials.
 */

export const COMPLETION_HEADERS = {
  'Content-Type': 'application/json',
  'accept': 'text/event-stream',
  'anthropic-client-platform': 'web_claude_ai',
} as const

/** Read the current user's org ID from the lastActiveOrg cookie. */
export async function getOrgId(): Promise<string | undefined> {
  const cookie = await chrome.cookies.get({ url: 'https://claude.ai', name: 'lastActiveOrg' })
  return cookie?.value
}

/** Build the base API URL for the current org. */
export function buildBaseUrl(orgId?: string): string {
  return orgId
    ? `https://claude.ai/api/organizations/${orgId}`
    : 'https://claude.ai/api'
}

/**
 * Read an SSE stream from claude.ai's completion endpoint and return the full text.
 */
export async function readCompletionStream(res: Response): Promise<string> {
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

/** Create a throwaway conversation. Returns its UUID. */
export async function createConversation(baseUrl: string, name = ''): Promise<string> {
  const res = await fetch(`${baseUrl}/chat_conversations`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ name }),
  })
  if (!res.ok) throw new Error(`Failed to create conversation: ${res.status}`)
  const data = (await res.json()) as { uuid: string }
  return data.uuid
}

/** Send a prompt to a conversation and return the full streamed response text. */
export async function sendCompletion(
  baseUrl: string,
  convUuid: string,
  prompt: string,
  maxTokens = 2000,
): Promise<string> {
  const res = await fetch(`${baseUrl}/chat_conversations/${convUuid}/completion`, {
    method: 'POST',
    headers: COMPLETION_HEADERS,
    credentials: 'include',
    body: JSON.stringify({
      prompt,
      model: 'claude-sonnet-4-6',
      max_tokens_to_sample: maxTokens,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      parent_message_uuid: '00000000-0000-4000-8000-000000000000',
      rendering_mode: 'raw',
      attachments: [],
      files: [],
    }),
  })
  if (!res.ok) throw new Error(`Completion API failed: ${res.status}`)
  return readCompletionStream(res)
}
