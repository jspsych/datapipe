---
"datapipe-client": minor
---

Pass the session to `saveData` with `session` instead of flushing and reading `sessionId` yourself. `saveData` waits for the session to start and sends its id.

Adds `session.ready()`, which resolves once the session has started (or failed to). It waits only for startup, not for staged writes, so a final submission from a background tab is no longer held up by a throttled flush. `sessionId` still works.
