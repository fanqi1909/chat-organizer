# TODO

## In Progress / Next Up

### Topic Detection Reliability
- [ ] Verify `apiDetect` is actually succeeding (add console.log in background to see API response)
- [ ] Consider alternative: use the messages already in the conversation (no throwaway conversation needed) — look at whether claude.ai exposes message history via API
- [ ] Tune word-overlap threshold (currently 20%) — may be too aggressive or too lenient depending on topic

### Conversation Manager UX
- [ ] After Organize, clicking a conversation group should navigate to that conversation
- [ ] "Re-organize" button to clear saved groups and run again
- [ ] Handle case where Recents DOM items don't load before ConversationManager injects

### Sidebar Injection Stability
- [ ] Test that `data-tp-injected` attribute survives different types of claude.ai re-renders
- [ ] Handle "Recents" section being hidden/collapsed by user (currently fails silently)
- [ ] Thread badge `[N]` positioning — may overlap with "···" more-options button on some screen sizes

---

## Backlog

### Core Features
- [ ] **Manual thread split**: user-triggered "start new thread here" button on any message
- [ ] **Thread naming**: let user rename a thread by clicking its title in sidebar
- [ ] **Thread merge**: merge two threads from same conversation into one
- [ ] **Thread search**: search across all archived thread titles and content
- [ ] **Export thread**: copy thread as markdown / send to new conversation

### Restore UX
- [ ] Restore to existing conversation (not always creating new) if conversation still exists
- [ ] Show restore preview: what context will be injected before navigating
- [ ] Smarter restore prompt: instead of raw history dump, summarize key points

### Conversation Organizer
- [ ] After grouping, clicking a group header navigates to first conversation in group
- [ ] Drag-and-drop to manually re-group conversations
- [ ] Merge conversations: select two conversations → creates one combined thread
- [ ] Save group names as tags/labels that persist even after Re-organize

### Detection
- [ ] Try using the actual conversation's message list (from claude.ai API) instead of DOM-observed text — more reliable, handles long messages
- [ ] Per-user tuning: let user adjust sensitivity slider in popup
- [ ] Learn from manual corrections: if user splits a thread manually, use as training signal

### Platform Support
- [ ] ChatGPT adapter (`src/content/platforms/chatgpt.ts` is stubbed)
- [ ] Gemini adapter

### Infrastructure
- [ ] Add `npm run typecheck` script separate from build
- [ ] Consider removing unused `src/content/ui/sidebar.tsx`, `thread-card.tsx`, `thread-group.tsx` (replaced by sidebar-injector.ts)
- [ ] Test with Manifest V3 service worker lifecycle (background may be killed after inactivity)

---

## Known Issues

- **Duplicate "CONVERSATIONS" section**: race condition mostly fixed with `isRefreshing` flag, but may still appear on very fast page loads — workaround: reload extension
- **Thread title "Conversation"**: fixed — now derived from last human message. Old threads in storage may still have this title.
- **Chinese topic detection**: CJK bigram tokenizer implemented, but overlap threshold needs real-world tuning
- **apiDetect silent failure**: fixed — now throws on empty response to trigger heuristic. But if claude.ai's internal API format changes again, detection will silently fall back to heuristic.
- **Observer watching document.body**: necessary because claude.ai renders messages OUTSIDE `<main>`. High-frequency mutations possible — debounce in `scanMessages()` may be needed if performance degrades.
