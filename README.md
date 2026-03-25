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

## How It Works

### Thread-as-you-chat

The extension watches for completed assistant messages. After each response, it analyzes the conversation to detect topic changes using two methods:

1. **AI detection** — calls claude.ai's internal API with recent message history, asks Haiku to classify new vs. same topic
2. **Heuristic fallback** — if API fails, uses keyword detection + word-overlap similarity (CJK-aware for Chinese/Japanese/Korean)

When a topic change is detected, the current thread is archived and a new one begins. Thread titles are derived from the user's message text.

### Sidebar Display

In claude.ai's native Recents sidebar:
- **Active conversation**: native title is dimmed; current thread title shown prominently with a purple dot
- **Other conversations**: a small `[N]` badge shows thread count, click to expand

### Conversation Organizer

A "Conversations" section appears above Recents. Click **Organize ▾** and choose a scope:
- **Recent (10)** — last 10 conversations
- **Medium (30)** — last 30 conversations
- **All** — entire Recents list

The extension sends conversation titles to Claude, which groups them by topic. Results are saved and persist across sessions.

## Development

```bash
npm run dev   # watch mode, auto-rebuilds on file change
```

Reload the extension in `chrome://extensions` after each build.

## Project Structure

```
src/
├── background/
│   └── index.ts          # Service worker: topic detection, thread restore, organize
├── content/
│   ├── platforms/         # DOM adapters per platform
│   │   ├── claude.ts      # claude.ai selectors (update if UI changes)
│   │   └── chatgpt.ts     # placeholder
│   ├── conversation-manager.ts  # "Conversations" section above Recents
│   ├── sidebar-injector.ts      # Thread display in native Recents items
│   ├── observer.ts        # MutationObserver for message detection
│   ├── thread-manager.ts  # Thread lifecycle + storage persistence
│   └── index.ts           # Content script entry point
├── popup/                 # Extension popup (toggle, session status)
└── shared/
    ├── types.ts            # Thread, Message, PlatformAdapter, ConversationGroup
    └── storage.ts          # chrome.storage.local helpers
```

## Troubleshooting

**Threads not being detected**: claude.ai may have updated its DOM. Check `src/content/platforms/claude.ts` selectors with DevTools. Key: `[data-is-streaming]` attribute on assistant message elements.

**Organize button not working**: The internal claude.ai API endpoint may have changed. Check Network tab on claude.ai while chatting to find the current `/completion` endpoint format.

**Double "Conversations" section**: Hard-reload the extension (`chrome://extensions` → reload). This can happen if the extension was updated without a full reload.
