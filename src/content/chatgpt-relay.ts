/**
 * ChatGPT MAIN world relay script.
 *
 * Injected at document_start in the MAIN world (page context).
 *
 * Problem: ChatGPT's own JS also patches window.fetch, overwriting our wrapper.
 * Solution: Use Object.defineProperty with a getter/setter trap so that whenever
 * ChatGPT (or any code) sets window.fetch, we automatically wrap the new value
 * with our interceptor. This way our caching layer persists no matter how many
 * times fetch gets reassigned.
 *
 * We cache sentinel tokens (Turnstile, PoW, Requirements) from ChatGPT's own
 * requests, then replay them when the extension needs to call the API for
 * Organize classification.
 *
 * Communication with the ISOLATED world content script is via window.postMessage.
 */

interface SentinelTokens {
  requirementsToken: string
  turnstileToken: string
  proofToken: string
  authorization: string
  timestamp: number
  oaiHeaders: Record<string, string>
}

let cachedTokens: SentinelTokens | null = null

// Save the true native fetch before anyone touches it
const nativeFetch = window.fetch

function extractSentinelTokens(url: string, init?: RequestInit) {
  if (
    !url.includes('/backend-api/f/conversation') ||
    url.includes('prepare') ||
    init?.method !== 'POST' ||
    !init?.headers ||
    typeof init.headers !== 'object' ||
    init.headers instanceof Headers
  ) {
    return
  }

  const h = init.headers as Record<string, string>
  const reqToken = h['OpenAI-Sentinel-Chat-Requirements-Token'] ?? ''
  const turnstile = h['OpenAI-Sentinel-Turnstile-Token'] ?? ''
  const proof = h['OpenAI-Sentinel-Proof-Token'] ?? ''
  const auth = h['Authorization'] ?? ''

  if (reqToken && auth) {
    const oaiHeaders: Record<string, string> = {}
    for (const [k, v] of Object.entries(h)) {
      if (
        k.startsWith('OAI-') ||
        k === 'X-OpenAI-Target-Path' ||
        k === 'X-OpenAI-Target-Route'
      ) {
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

function wrapFetch(target: typeof fetch): typeof fetch {
  return function (
    this: typeof globalThis,
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> {
    const url =
      typeof input === 'string'
        ? input
        : input instanceof Request
          ? input.url
          : String(input)
    extractSentinelTokens(url, init)
    return target.call(this, input, init)
  } as typeof fetch
}

// Use defineProperty to intercept any future assignments to window.fetch.
// This survives ChatGPT's own fetch-patching.
let currentFetch = wrapFetch(nativeFetch)

Object.defineProperty(window, 'fetch', {
  configurable: true,
  enumerable: true,
  get() {
    return currentFetch
  },
  set(newFetch: typeof fetch) {
    // ChatGPT (or another script) is reassigning fetch.
    // Wrap the new value so our interceptor stays in the chain.
    currentFetch = wrapFetch(newFetch)
  },
})

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

    // Use nativeFetch to avoid our own interceptor loop
    const res = await nativeFetch.call(window, '/backend-api/f/conversation', {
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
