# ChatGPT API Findings — Organize Feature

## Date: 2026-04-02

## Goal

Make the ChatGPT Organize feature use AI-powered topic classification (same as Claude), instead of a heuristic fallback. This requires calling ChatGPT's internal API to send a classification prompt.

## ChatGPT Internal API Architecture (as of April 2026)

### Authentication

- **Access Token**: `GET /api/auth/session` returns `{ accessToken }`. Cached ~5min. Used as `Authorization: Bearer {token}`.
- **Read APIs** (fetching conversations, Q&A pairs): work with just the Bearer token. No Turnstile/PoW needed.

### Write API — New Flow (prepare → finalize → /f/conversation)

ChatGPT has migrated to a new conversation endpoint:

```
1. POST /backend-api/sentinel/chat-requirements/prepare
   Body: {}
   Returns: { prepare_token, turnstile: { required, dx }, proofofwork: { required, seed, difficulty } }

2. POST /backend-api/sentinel/chat-requirements/finalize
   Body: { prepare_token, [turnstile_response], [proof_of_work] }
   Returns: { token }  (the chat-requirements token)

3. POST /backend-api/f/conversation
   Headers:
     - Authorization: Bearer {accessToken}
     - OpenAI-Sentinel-Chat-Requirements-Token: {from finalize}
     - OpenAI-Sentinel-Turnstile-Token: {turnstile solution}
     - OpenAI-Sentinel-Proof-Token: {PoW solution}
     - OAI-Device-Id, OAI-Language, OAI-Session-Id, etc.
   Body: { action, messages, model, ... }
   Returns: SSE stream (same format as old /backend-api/conversation)
```

The old endpoint `POST /backend-api/conversation` still exists but also requires the same sentinel tokens.

### Required Tokens for Write API

| Token | Source | Can we generate it? |
|-------|--------|-------------------|
| Bearer token | `/api/auth/session` | Yes (from service worker or content script) |
| Chat-requirements token | `/sentinel/chat-requirements/finalize` | Yes (returns 200 even without Turnstile) |
| **Turnstile token** | Cloudflare Turnstile challenge solver | **No** — embedded in ChatGPT's JS bundle, not accessible externally |
| **Proof-of-Work token** | SHA-256 PoW computation | Yes — `crypto.subtle.digest('SHA-256', ...)` works in both service worker and page context |

### Key Finding: Turnstile is the Blocker

- `window.turnstile` does **not** exist on the ChatGPT page — they don't use the standard Cloudflare Turnstile widget.
- No `<iframe src="turnstile">`, no `<script src="challenges.cloudflare">`, no `.cf-turnstile` elements found.
- The Turnstile challenge solver is embedded inside ChatGPT's own JS bundle (possibly the 267K inline script or lazily loaded chunks).
- The `turnstile.dx` field in the prepare response is a large encoded blob (~2KB), likely the challenge data that their custom solver processes.
- Sentinel tokens are **single-use** — caching and replaying them results in 403 "Unusual activity detected".

### Proof-of-Work Details

```
{ required: true, seed: "0.35185945698939547", difficulty: "070e16" }
```

- Algorithm: SHA-256 (not SHA-3 as previously suspected)
- Find nonce where `SHA-256(seed + nonce)` starts with bytes ≤ difficulty prefix
- Solvable via `crypto.subtle.digest('SHA-256', ...)` — works in service worker
- Typically solves in < 100 iterations (very low difficulty for paid accounts)

## Approaches Tried

### 1. Service Worker Direct API Call
- **Result**: 403 — no Turnstile token available in service worker context
- Missing sentinel tokens entirely

### 2. Content Script (Isolated World) API Call
- **Result**: 403 — same origin cookies work, sentinel token obtained, but Turnstile token missing
- `prepare` and `finalize` both return 200, but the returned token isn't sufficient without Turnstile

### 3. Content Script with PoW (no Turnstile)
- **Result**: 403 — PoW alone doesn't satisfy the requirement; Turnstile is independently required

### 4. MAIN World Script — fetch Interception
- **Goal**: Patch `window.fetch` to cache sentinel tokens from ChatGPT's own requests, then replay them
- **Problem 1**: ChatGPT's JS also patches `fetch`, overwriting our wrapper
- **Fix**: Used `Object.defineProperty` with getter/setter trap — this survives ChatGPT's reassignment
- **Problem 2**: Sentinel tokens are **single-use** — replaying cached tokens → 403 "Unusual activity"
- **Result**: Interception works (tokens are captured), but tokens can't be reused

### 5. MAIN World Script — Direct Turnstile Access
- `window.turnstile` is `undefined` — no standard Turnstile API on the page
- No Turnstile iframes, scripts, or DOM elements found
- ChatGPT uses a custom/proprietary Turnstile integration embedded in their bundle

## What Works Now

### Heuristic Clustering (Fallback)
The extension falls back to keyword-based heuristic clustering when AI classification fails:
- Tokenizes question text (CJK bigrams + Latin words, length ≥ 2)
- Counts global token frequency across all questions
- Groups pairs by their most frequent shared keyword
- Group names derived from primary + secondary frequent tokens

Quality is reasonable for clearly distinct topics (e.g., "github", "docker", "travel") but struggles with nuanced or overlapping topics.

### Architecture in Place
The MAIN world relay architecture is fully implemented and ready:
- `chatgpt-relay.ts` (MAIN world): fetch interceptor + API relay via postMessage
- `content/index.ts`: bridge between background and MAIN world
- `background/index.ts`: tries relay first, falls back to heuristic
- If a future method to obtain Turnstile tokens is found, only `chatgpt-relay.ts` needs updating

## Future Directions

### Option A: Reverse-Engineer ChatGPT's Turnstile Solver
- Locate the solver in ChatGPT's JS bundle (possibly in lazy-loaded chunks)
- Extract the function that processes the `turnstile.dx` challenge data
- Call it directly from the MAIN world script
- **Risk**: Fragile, breaks on every ChatGPT update

### Option B: OpenAI Public API Key
- Add a settings field for the user's OpenAI API key
- Call `api.openai.com` directly (no Turnstile needed)
- Use `gpt-4o-mini` for classification (~$0.001 per organize)
- **Trade-off**: Requires user to have and enter an API key

### Option C: Improve Heuristic
- TF-IDF weighting instead of raw frequency
- Cosine similarity for pairwise comparison
- Pre-built topic taxonomy for common categories
- **Trade-off**: Never as good as AI, but zero cost and zero dependencies

### Option D: Intercept at Network Level
- Use `chrome.debugger` API to intercept and modify network requests
- Can inject headers into outgoing requests
- **Trade-off**: Requires `debugger` permission, shows "Chrome is being debugged" banner

### Option E: Wait for ChatGPT API Changes
- ChatGPT's API changes frequently — Turnstile requirements may be relaxed for paid users
- The relay architecture is ready to take advantage of any relaxation
