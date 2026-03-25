# Architecture Q&A

Common questions about how Chat Organizer is built and why.

---

## General

**Q: What kind of extension is this?**

A Chrome Extension using Manifest V3. It injects a content script into claude.ai pages, runs a background service worker for API calls, and uses a small React popup for the enable/disable toggle.

**Q: Does it need an API key?**

No. It piggybacks on the user's existing claude.ai session cookie (`__Secure-next-auth.session-token`) to call claude.ai's internal API. The user just needs to be logged in.

**Q: Does it work on other AI chat platforms?**

Currently only claude.ai. ChatGPT support is planned. The codebase has a `PlatformAdapter` interface and a platform registry (`src/content/platforms/index.ts`) designed to support multiple hosts.

---

## Topic Detection

**Q: How does the extension know when you've switched topics?**

Two-tier detection runs after every completed assistant message:

1. **apiDetect** — Creates a throwaway claude.ai conversation, sends recent message history, and asks the model: "Is this a continuation of the same topic or a new one?" Returns `{ newThread: boolean, title: string }`.
2. **heuristicDetect** (fallback) — Checks for explicit transition phrases ("actually, can you help me with", "switching topics", etc.) and computes word-overlap similarity between consecutive message pairs. Less than 20% overlap → new topic.

**Q: Why does apiDetect create a "throwaway" conversation?**

The claude.ai API doesn't have a stateless classify endpoint. Creating a temporary conversation is the only way to get a model response. These conversations are created programmatically and not visible to the user in the normal Recents list (they're cleaned up or simply ignored).

**Q: Why must apiDetect throw on failure instead of returning `{newThread: false}`?**

A silent false return silently bypasses heuristic fallback. If the API response is empty or unparseable, we want to fall through to the heuristic. Always throwing ensures the caller's try/catch triggers the fallback.

**Q: How does CJK (Chinese/Japanese/Korean) topic detection work?**

Standard `\W+` word splitting doesn't work for Chinese — every character is a "word" character and there are no spaces. For CJK text, the tokenizer generates character bigrams (sliding windows of 2 characters) instead of splitting by whitespace. Word-overlap similarity between two sets of bigrams works surprisingly well as a semantic proxy.

---

## Sidebar Injection

**Q: Why not build a custom sidebar panel?**

Early versions used a 260px fixed sidebar that pushed page content. This was visually jarring and broke claude.ai's layout. Injecting into the *existing* native Recents sidebar is much less invasive and feels native.

**Q: Why not use Shadow DOM?**

Shadow DOM prevents the CSS custom properties (`--text-text-100`, `--bg-300`, etc.) defined by claude.ai from being inherited into our injected elements. Plain DOM injection with no shadow boundary means our elements automatically inherit claude.ai's theme variables, so they look native without any extra styling.

**Q: claude.ai is a React SPA. How does the sidebar survive React re-renders?**

Three rules:

1. **Never mutate React-owned text nodes.** If React re-renders, it will overwrite any text we changed. Instead, we only *append* new child elements.
2. **Use CSS, not DOM mutations, for visual changes.** A persistent `<style id="tp-styles">` in `<head>` survives re-renders. We use attribute selectors (e.g., `li[data-tp-active] .truncate { opacity: 0.4 }`) to dim the native title.
3. **Re-inject if removed.** A MutationObserver watches for removed `data-tp-injected` elements and re-injects them if React clears the DOM.

**Q: How does the active conversation get its visual treatment?**

We set a `data-tp-active` attribute on the `<li>` element for the current conversation. CSS in our persistent `<style>` tag targets `li[data-tp-active] .truncate` to make the native title smaller and dimmer. Our injected active thread title then becomes the visual primary — no text node mutation needed.

**Q: What prevents double-injection of the Conversations section?**

`ConversationManager.buildSection()` is async. If two MutationObserver callbacks fire concurrently (common on SPA navigation), both can enter `buildSection()` and produce two Conversations sections. An `isRefreshing` boolean guards entry, plus a post-await re-check removes any duplicate that slipped through.

---

## Thread Management

**Q: What is a "thread"?**

A contiguous sequence of messages within a single claude.ai conversation that share a topic. A single claude.ai conversation can contain multiple threads if you change subjects.

**Q: Where are threads stored?**

In `chrome.storage.local`:
- `active_thread:{conversationId}` — the current in-progress thread
- `archived_threads` — all finished threads (across all conversations)

**Q: How are thread titles generated?**

From the text of the last human message, truncated to 50 characters. Not from the API — API-generated titles tend to be generic ("Conversation", "Chat", etc.).

**Q: How does thread restore work?**

When a user clicks an archived thread:

1. Background tries to create a new claude.ai conversation via the internal API, pre-populated with the full thread history as context.
2. If that succeeds, the extension navigates to `https://claude.ai/chat/{newConversationId}`.
3. If the API call fails, it falls back to navigating to `/new`, waiting for the input box to appear, injecting a formatted summary of the thread history, and submitting it — so Claude has context to continue from.

---

## Conversation Organizer

**Q: What does "Organize" actually do?**

It collects Q&A pairs (question + answer) from your recent conversations, sends them in a single batch request to Claude (via the internal API), and asks it to return a JSON array of topic groups. Each group has a name and a list of Q&A pair IDs. The extension then renders these as collapsible sections above Recents.

**Q: How many tokens does an organize call use?**

The extension caps at 300 Q&A pairs (~21k tokens estimated). Each conversation contributes up to 8 pairs. The batch is truncated if it exceeds this limit.

**Q: Do organize results persist?**

Yes. Groups are saved to `chrome.storage.local` under `topic_groups`. They survive page refreshes and browser restarts until you run Organize again or click the clear button.

---

## Message Flow

**Q: Walk me through the full message flow.**

```
1. User sends a message on claude.ai
2. Claude responds; data-is-streaming attribute goes "true" → "false"
3. MutationObserver (observer.ts) detects the attribute change on document.body
4. Content script sends NEW_MESSAGE to background service worker
5. Background runs apiDetect; on failure, runs heuristicDetect
6. Returns { newThread: boolean, title: string }
7. If newThread=true:
   - ThreadManager archives current thread
   - ThreadManager starts new thread with the given title
8. SidebarInjector.refresh() updates Recents sidebar DOM
```

**Q: Why does the MutationObserver watch `document.body` instead of `<main>`?**

On claude.ai, assistant message elements are not inside `<main>` — they render elsewhere in the DOM. Watching only `<main>` would miss them. The observer uses `attributeFilter: ['data-is-streaming']` to avoid performance issues from watching all mutations on body.

---

## Build & Configuration

**Q: Why CRXJS instead of a plain Vite build?**

CRXJS handles the Chrome Extension–specific bundling concerns: generating the correct manifest output, handling hot-reload during development, and correctly splitting background/content/popup entry points. It's much less boilerplate than manually configuring Vite for MV3.

**Q: Why React only in the popup?**

The sidebar injection is plain DOM because:
1. React-in-React (our React inside claude.ai's React) causes reconciliation conflicts
2. Shadow DOM (which would isolate our React) breaks CSS variable inheritance
3. The sidebar UI is simple enough that React's complexity isn't worth it

The popup has no such constraints, so React is fine there.

**Q: How do I add support for a new platform?**

1. Create `src/content/platforms/<name>.ts` implementing `PlatformAdapter`
2. Register it in `src/content/platforms/index.ts` (the `hostToAdapter` map)
3. Add the domain to `manifest.json` under `content_scripts.matches` and `host_permissions`

The background service worker uses the platform adapter indirectly via the content script's message relay, so no changes are needed there for basic message detection.

---

## Known Fragilities

**Q: What breaks most often after a claude.ai update?**

In order of likelihood:

1. **DOM selectors** in `src/content/platforms/claude.ts` — `[data-is-streaming]`, `[data-testid="user-message"]`, `.font-claude-response`, `h2[role="button"]`. Verify these in DevTools when threading stops working.
2. **Internal API format** — endpoint: `POST /api/organizations/{orgId}/chat_conversations`. Inspect Network tab to see the current request/response shape.
3. **Session cookie name** — currently `__Secure-next-auth.session-token`. Check Application → Cookies if the extension stops recognizing the session.

**Q: Are there any race conditions?**

One known race: concurrent MutationObserver callbacks both entering async `buildSection()` in ConversationManager. Guarded by `isRefreshing` flag + post-await re-check. Mostly eliminated, but can still manifest on very fast SPA navigations.
