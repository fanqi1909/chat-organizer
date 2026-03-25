# Chat Organizer — Thread Plugin

A Chrome extension that brings intelligent thread management to claude.ai. Automatically groups messages by topic as you chat, and lets you organize, archive, and restore past conversations.

## Features

- **Auto-threading** — detects topic changes mid-conversation, groups messages into named threads
- **Native sidebar integration** — threads appear directly in claude.ai's Recents sidebar (no extra panel)
- **Conversation Organizer** — one-click AI-powered grouping of your recent conversations by topic
- **Thread restore** — click any archived thread to continue it in a new claude.ai conversation
- **No API key required** — reuses your existing claude.ai session cookie

## Supported Platforms

| Platform | Status |
|---|---|
| claude.ai | Supported |
| ChatGPT | Planned |

## Getting Started

### Prerequisites

- Node.js 18+
- Chrome or Edge (Chromium-based)
- An active claude.ai account (Pro or free)

### Build

```bash
npm install
npm run build
```

### Load in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `dist/` folder
4. Open [claude.ai](https://claude.ai) and start chatting

### Development (watch mode)

```bash
npm run dev   # auto-rebuilds on file change
```

Reload the extension in `chrome://extensions` after each build.

---

## How It Works

### Thread-as-you-chat

The extension watches for completed assistant messages via a MutationObserver on `document.body`. After each response, it analyzes the conversation to detect topic changes using two methods:

1. **AI detection** — calls claude.ai's internal API with recent message history, asks the model to classify new vs. same topic
2. **Heuristic fallback** — if API fails, uses keyword detection + word-overlap similarity (CJK-aware for Chinese/Japanese/Korean)

When a topic change is detected, the current thread is archived and a new one begins. Thread titles are derived from the user's last message text (truncated to 50 chars).

### Sidebar Display

In claude.ai's native Recents sidebar:
- **Active conversation**: native title is dimmed via CSS; current thread title shown prominently with a purple dot; up to 3 recent archived threads listed below
- **Other conversations**: a small `[N]` badge shows thread count; click to expand

The extension uses an **append-only + CSS strategy** to avoid fighting React's reconciliation. It never modifies React-owned DOM text nodes — it only appends children and uses a persistent `<style>` tag for all visual overrides.

### Conversation Organizer

A "Conversations" section appears above Recents. Click **Organize ▾** and choose a scope:

| Scope | Conversations fetched |
|---|---|
| Recent (10) | Last 10 |
| Medium (30) | Last 30 |
| All | Entire Recents list |

The extension fetches Q&A pairs from each conversation (up to 8 pairs each, capped at 300 total), sends them to Claude, and receives back topic groups. Results persist in `chrome.storage.local` across sessions.

Click any Q&A pair to navigate directly to that conversation.

### Thread Restore

Click any archived thread in the sidebar. The extension will:

1. **Try**: Create a new conversation via the claude.ai API, pre-populated with the thread's message history
2. **Fallback**: Navigate to `/new` and inject the thread context into the input box, then submit

---

## Project Structure

```
src/
├── background/
│   └── index.ts                  # Service worker: topic detection, thread restore, organize
├── content/
│   ├── platforms/
│   │   ├── claude.ts             # claude.ai DOM selectors (update here if UI breaks)
│   │   └── chatgpt.ts            # placeholder
│   ├── conversation-manager.ts   # "Conversations" section injected above Recents
│   ├── sidebar-injector.ts       # Thread badges/items in native Recents sidebar
│   ├── observer.ts               # MutationObserver: detects completed assistant messages
│   ├── thread-manager.ts         # Thread lifecycle + storage persistence
│   └── index.ts                  # Content script entry point
├── popup/                        # Extension popup (toggle, session status)
└── shared/
    ├── types.ts                  # Thread, Message, PlatformAdapter, TopicGroup, QAPair
    └── storage.ts                # chrome.storage.local helpers
```

### Storage Keys

```
archived_threads          → Thread[]           All archived threads
active_thread:{convId}    → Thread             Current active thread per conversation
topic_groups              → TopicGroup[]       Last organize results
pending_inject            → Thread             Temp: thread to inject on /new page
settings                  → { threadingEnabled: boolean }
```

---

## Troubleshooting

**Threads not being detected**
claude.ai may have updated its DOM. Check selectors in `src/content/platforms/claude.ts` with DevTools. Key attribute: `[data-is-streaming]` on assistant message elements.

**Organize not working**
The internal claude.ai API format may have changed. Open DevTools → Network tab on claude.ai while sending a message, find the current `/completion` endpoint format, and update `background/index.ts`.

**Double "Conversations" section on page load**
Hard-reload the extension in `chrome://extensions`. Rarely happens — guarded by `isRefreshing` flag.

**Session not recognized (popup shows "Not logged in")**
The session cookie name `__Secure-next-auth.session-token` may have changed. Check Application → Cookies in DevTools on claude.ai.

---

## Tests

```bash
npm run test        # run once
npm run test:watch  # watch mode
```

Test files: `src/background/__tests__/`, `src/shared/__tests__/`

---

## Adding a New Platform

1. Create `src/content/platforms/<name>.ts` implementing `PlatformAdapter`
2. Register it in `src/content/platforms/index.ts` (hostToAdapter map)
3. Add the domain to `manifest.json` → `content_scripts.matches` and `host_permissions`
