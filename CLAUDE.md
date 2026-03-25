# CLAUDE.md

## Project Overview

Chrome Extension (Manifest V3) that adds intelligent thread management to claude.ai conversations.
Built with TypeScript + Vite + CRXJS + React (popup only — sidebar uses plain DOM injection).

## Commands

```bash
npm install       # install dependencies
npm run build     # production build → dist/
npm run dev       # watch mode build (reload extension manually after each build)
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Architecture

### Key Files

| File | Purpose |
|---|---|
| `src/background/index.ts` | Service worker: topic detection, thread restore, conversation organize via claude.ai API |
| `src/content/index.ts` | Content script entry: bootstraps observer, thread manager, sidebar injector, conversation manager |
| `src/content/platforms/claude.ts` | claude.ai DOM selectors — update here if selectors break |
| `src/content/observer.ts` | MutationObserver watching `document.body` for completed assistant messages |
| `src/content/thread-manager.ts` | Thread state: create, add messages, archive, persist active thread to storage |
| `src/content/sidebar-injector.ts` | Injects thread info into claude.ai's native Recents sidebar (plain DOM, no React) |
| `src/content/conversation-manager.ts` | Injects "Conversations" section above Recents with Organize functionality |
| `src/shared/types.ts` | All shared TypeScript types (Thread, Message, PlatformAdapter, ConversationGroup) |
| `src/shared/storage.ts` | chrome.storage.local wrappers |
| `src/popup/popup.tsx` | Extension popup: on/off toggle, session status |

### Message Flow

```
claude.ai page → observer.ts detects completed assistant message (data-is-streaming="false")
              → content/index.ts sends NEW_MESSAGE to background
              → background: try apiDetect (claude.ai internal API) → fallback to heuristicDetect
              → returns { newThread: boolean, title: string }
              → ThreadManager: archive current thread if newThread, start new thread
              → SidebarInjector.refresh() updates native sidebar UI
```

### Sidebar Injection Strategy

**Key insight**: claude.ai is a React SPA that aggressively re-renders its sidebar. We use an **append-only + CSS** approach to avoid fighting React reconciliation:

- Never modify React-owned DOM nodes (no text content changes)
- Only **append** new child elements to `<li>` items
- Use a persistent `<style id="tp-styles">` in `<head>` for visual changes (CSS survives re-renders)
- `data-tp-injected` attribute tracks what we've injected; MutationObserver re-injects on removal

**Current conversation**: `data-tp-active` attribute on `<li>` triggers CSS that downgrades the native title (smaller, dimmer), making our injected active thread the visual primary.

**Other conversations**: Small `[N]` badge appended to `div.relative`, clickable to expand thread list.

**ConversationManager**: Injected BEFORE the Recents section container. Uses `isRefreshing` flag + post-async re-check to prevent double injection from concurrent async `buildSection()` calls.

### Topic Detection

Two-tier detection in `src/background/index.ts`:

1. **apiDetect** — creates throwaway claude.ai conversation, asks Haiku to classify. Throws on empty/unparseable response to trigger heuristic fallback (not silent false return).
2. **heuristicDetect** — explicit transition phrases + CJK-aware bigram tokenizer for word-overlap similarity. `< 20%` overlap → new topic. Works for both English and Chinese/Japanese/Korean.

### Storage Layout

```
archived_threads          → Thread[]          (all archived threads)
active_thread:{convId}    → Thread            (current active thread per conversation)
conversation_groups       → ConversationGroup[] (organize results)
pending_inject            → Thread            (temp: thread to inject on /new page)
settings                  → { threadingEnabled: boolean }
```

### Conversation Organizer

User-triggered (not automatic). Flow:
1. User clicks "Organize ▾" in Conversations section → selects scope (recent 10 / medium 30 / all)
2. Collects conversation titles + previews from Recents DOM
3. Background sends to claude.ai API: "group these by topic, return JSON"
4. Groups saved to storage, section re-renders with topic groupings
5. Animated progress bar visible during API call (~5-15s)

### Adding a New Platform

1. Create `src/content/platforms/<name>.ts` implementing `PlatformAdapter`
2. Register it in `src/content/platforms/index.ts` (hostToAdapter map)
3. Add the domain to `manifest.json` → `content_scripts.matches` and `host_permissions`

## Known Fragilities

- **claude.ai DOM selectors** in `src/content/platforms/claude.ts` — verify with DevTools if threading stops working after a claude.ai update. Key selectors: `[data-is-streaming]`, `[data-testid="user-message"]`, `.font-claude-response`, `h2[role="button"]` for Recents header
- **claude.ai internal API** in `src/background/index.ts` — endpoint: `POST /api/organizations/{orgId}/chat_conversations` + `/completion`. Inspect Network tab to confirm format after claude.ai updates
- **Session cookie name**: `__Secure-next-auth.session-token` — may change
- **MutationObserver on document.body** — messages are NOT inside `<main>` on claude.ai, they render elsewhere. Observer must watch `document.body` with `attributeFilter: ['data-is-streaming']`

## Key Decisions & Lessons Learned

- **No custom sidebar**: Replaced 260px fixed sidebar (which pushed page content) with native sidebar injection. Much less invasive, feels native.
- **No Shadow DOM for sidebar**: Shadow DOM prevents claude.ai CSS variables (`--text-text-100` etc.) from being inherited. Plain DOM injection + CSS variables gives a native look.
- **No React in sidebar**: Plain DOM avoids React-in-React conflicts with claude.ai's own React tree.
- **CSS-only title downgrade**: Never mutate React text nodes. Use CSS attribute selectors to visually deprioritize native titles.
- **apiDetect must throw on failure**: Silent `return {newThread: false}` on empty API response bypasses heuristic fallback. Always throw so caller can fallback.
- **CJK tokenization**: Standard `\W+` split fails for Chinese (all chars are non-word). Use character bigrams for semantic overlap detection.
- **Thread title from human message**: Derive title from last human message text (truncate to 50 chars), not from API (which returns generic titles like "Conversation").
- **isRefreshing flag**: async `buildSection()` + concurrent MutationObserver callbacks = double injection. Guard with `isRefreshing` boolean + post-await re-check.
