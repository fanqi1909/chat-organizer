/**
 * ChatGPT MAIN world relay script.
 *
 * Injected at document_start in the MAIN world (page context) so it patches
 * fetch BEFORE ChatGPT's own JS caches the reference. This lets us:
 *
 * 1. Cache sentinel tokens (Turnstile, PoW, Requirements) from ChatGPT's
 *    own requests whenever the user sends a message normally.
 * 2. Replay those cached tokens when the extension needs to make its own
 *    API call (e.g. for Organize classification).
 *
 * Communication with the ISOLATED world content script is via window.postMessage.
 */

interface SentinelTokens {
  requirementsToken: string
  turnstileToken: string
  proofToken: string
  authorization: string
  timestamp: number
  /** Extra OAI headers needed for the request */
  oaiHeaders: Record<string, string>
}

// Cached sentinel tokens from ChatGPT's most recent conversation request
let cachedTokens: SentinelTokens | null = null

// Patch fetch before ChatGPT's bundle loads
const origFetch = window.fetch

window.fetch = function (
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const url =
    typeof input === 'string'
      ? input
      : input instanceof Request
        ? input.url
        : String(input)

  // Intercept ChatGPT's /f/conversation request to cache sentinel tokens
  if (
    url.includes('/backend-api/f/conversation') &&
    !url.includes('prepare') &&
    init?.method === 'POST' &&
    init?.headers &&
    typeof init.headers === 'object' &&
    !(init.headers instanceof Headers)
  ) {
    const h = init.headers as Record<string, string>
    const reqToken = h['OpenAI-Sentinel-Chat-Requirements-Token'] ?? ''
    const turnstile = h['OpenAI-Sentinel-Turnstile-Token'] ?? ''
    const proof = h['OpenAI-Sentinel-Proof-Token'] ?? ''
    const auth = h['Authorization'] ?? ''

    if (reqToken && auth) {
      const oaiHeaders: Record<string, string> = {}
      for (const [k, v] of Object.entries(h)) {
        if (k.startsWith('OAI-') || k === 'X-OpenAI-Target-Path' || k === 'X-OpenAI-Target-Route') {
          oaiHeaders[k] = v
        }
      }
      cachedTokens = {
        requirementsToken: reqToken,
        turnstileToken: turnstile,
        proofToken: proof,
        authorization: auth,
        timestamp: Date.now(),
        oaiHeaders,
      }
    }
  }

  return origFetch.call(this, input, init)
} as typeof fetch

// Listen for classification requests from content script (ISOLATED world)
window.addEventListener('message', async (event) => {
  if (event.source !== window) return
  if (event.data?.type !== 'TP_CHATGPT_CLASSIFY') return

  const { prompt, requestId } = event.data

  try {
    if (!cachedTokens || Date.now() - cachedTokens.timestamp > 5 * 60 * 1000) {
      throw new Error(
        'No cached ChatGPT tokens. Send a message in ChatGPT first to initialize.',
      )
    }

    const body = {
      action: 'next',
      messages: [
        {
          id: crypto.randomUUID(),
          author: { role: 'user' },
          content: { content_type: 'text', parts: [prompt] },
        },
      ],
      model: 'gpt-4o-mini',
      timezone_offset_min: new Date().getTimezoneOffset(),
      conversation_mode: { kind: 'primary_assistant' },
      force_nulligen: false,
      force_paragen: false,
      force_paragen_model_slug: '',
      force_rate_limit: false,
      reset_rate_limits: false,
      websocket_request_id: crypto.randomUUID(),
    }

    const headers: Record<string, string> = {
      ...cachedTokens.oaiHeaders,
      'Authorization': cachedTokens.authorization,
      'Content-Type': 'application/json',
      'OpenAI-Sentinel-Chat-Requirements-Token': cachedTokens.requirementsToken,
      'OpenAI-Sentinel-Turnstile-Token': cachedTokens.turnstileToken,
      'OpenAI-Sentinel-Proof-Token': cachedTokens.proofToken,
    }

    const res = await origFetch.call(window, '/backend-api/f/conversation', {
      method: 'POST',
      headers,
      credentials: 'include',
      body: JSON.stringify(body),
    })

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`ChatGPT API ${res.status}: ${errText.slice(0, 200)}`)
    }

    // Parse SSE stream
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')
    const decoder = new TextDecoder()
    let fullText = ''
    let conversationId = ''
    let done = false

    while (!done) {
      const result = await reader.read()
      done = result.done
      if (result.value) {
        const chunk = decoder.decode(result.value, { stream: true })
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const raw = line.slice(6).trim()
          if (raw === '[DONE]') {
            done = true
            break
          }
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
              fullText = parsed.message.content.parts[0]
            }
          } catch {
            /* ignore parse errors */
          }
        }
      }
    }

    window.postMessage(
      { type: 'TP_CHATGPT_CLASSIFY_RESULT', requestId, text: fullText, conversationId },
      '*',
    )
  } catch (err) {
    window.postMessage(
      {
        type: 'TP_CHATGPT_CLASSIFY_RESULT',
        requestId,
        error: String(err instanceof Error ? err.message : err),
      },
      '*',
    )
  }
})

// Signal that the relay is ready
window.postMessage({ type: 'TP_CHATGPT_RELAY_READY' }, '*')
