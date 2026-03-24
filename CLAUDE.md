# CLAUDE.md

## Project Overview

Chrome Extension (Manifest V3) that adds auto-threading to claude.ai conversations.
Built with TypeScript + Vite + CRXJS + React.

## Commands

```bash
npm install       # install dependencies
npm run dev       # watch mode build (reload extension manually after each build)
npm run build     # production build → dist/
```

Load `dist/` as an unpacked extension in `chrome://extensions`.

## Architecture

### Key Files

| File | Purpose |
|---|---|
| `src/background/index.ts` | Service worker: reads session cookie, calls claude.ai internal API for topic detection |
| `src/content/index.ts` | Content script entry: bootstraps observer, thread manager, sidebar |
| `src/content/platforms/claude.ts` | claude.ai DOM selectors — update here if selectors break |
| `src/content/observer.ts` | MutationObserver watching for new completed assistant messages |
| `src/content/thread-manager.ts` | Thread state: create, add messages, archive |
| `src/content/ui/sidebar.tsx` | Left sidebar showing archived threads |
| `src/shared/types.ts` | All shared TypeScript types (Thread, Message, PlatformAdapter) |
| `src/shared/storage.ts` | chrome.storage.local wrappers |

### Message Flow

```
claude.ai page → observer.ts detects new assistant message
              → content/index.ts sends to background (chrome.runtime.sendMessage)
              → background reads session cookie, calls claude.ai API
              → returns { newThread: boolean, title: string }
              → content script updates ThreadManager → renders UI
```

### Adding a New Platform

1. Create `src/content/platforms/<name>.ts` implementing `PlatformAdapter`
2. Register it in `src/content/platforms/index.ts` (hostToAdapter map)
3. Add the domain to `manifest.json` → `content_scripts.matches` and `host_permissions`

## Known Fragilities

- **claude.ai DOM selectors** in `src/content/platforms/claude.ts` — verify with DevTools if threading stops working after a claude.ai update
- **claude.ai internal API endpoint** in `src/background/index.ts` (`apiDetect` function) — inspect Network tab on claude.ai to confirm current endpoint/body format
- Session cookie name: `__Secure-next-auth.session-token` — may change

## Decisions

- No API key required: reuse claude.ai session cookie via `chrome.cookies`
- Shadow DOM for UI injection to avoid CSS conflicts with claude.ai
- Heuristic keyword fallback when API call fails
- ChatGPT adapter stubbed out (`src/content/platforms/chatgpt.ts`) for future implementation
