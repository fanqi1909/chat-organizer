# Chat Organizer — Thread Plugin

A Chrome extension that brings automatic threading to claude.ai conversations.

When you discuss multiple topics in a single chat, the plugin detects topic changes and groups messages into threads. Completed threads can be archived to a persistent sidebar, keeping your conversation clean while preserving the full context.

## Features

- **Auto-threading** — AI detects topic boundaries and groups messages automatically
- **Archived sidebar** — completed threads saved to a left-side panel, persists across sessions
- **Quote** — reference an archived thread back into the current conversation
- **No API key required** — reuses your existing claude.ai session

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

## Development

```bash
npm run dev   # watch mode, auto-rebuilds on file change
```

Reload the extension in `chrome://extensions` after each build.

## Project Structure

```
src/
├── background/       # Service worker: topic detection via claude.ai session API
├── content/
│   ├── platforms/    # DOM adapters (claude.ts, chatgpt.ts placeholder)
│   ├── ui/           # React components (sidebar, thread group, thread card)
│   ├── observer.ts   # MutationObserver for new messages
│   └── thread-manager.ts
├── popup/            # Extension popup (on/off toggle, session status)
└── shared/           # Types and chrome.storage helpers
```

## Notes

- Topic detection calls claude.ai's internal API using your session cookie — no extra authentication needed
- If the internal API changes, detection falls back to keyword-based heuristics
- DOM selectors for claude.ai are in `src/content/platforms/claude.ts` and may need updating if claude.ai changes its markup
