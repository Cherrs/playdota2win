# Online Visitors Feature Design

**Date:** 2026-03-06  
**Feature:** Admin panel shows online users with IP and browser info

## Problem

The admin panel has no visibility into who is currently visiting the site. Adding real-time online visitor tracking (IP + User-Agent) in the admin panel improves site oversight.

## Approach

Extend the existing `ChatRoom` Durable Object to capture IP and User-Agent from every WebSocket handshake request. Page visitors silently connect to the chat WebSocket on mount, registering their presence. The admin panel polls a new API endpoint every 5 seconds to display the current online visitor list.

## Data Structures

### New type in `src/lib/types.ts`

```ts
export interface OnlineVisitor {
  ip: string;
  userAgent: string;
  connectedAt: number;
  nickname: string;
}
```

### Extended `SessionState` in `chat-room.ts`

```ts
interface SessionState {
  nickname: string;
  sentTimestamps: number[];
  ip: string;
  userAgent: string;
  connectedAt: number;
}
```

## Backend Changes

### `src/lib/server/chat/chat-room.ts`

- In `fetch()`, when accepting a WebSocket, read `CF-Connecting-IP` (falling back to `X-Forwarded-For`) and `User-Agent` headers from the request. Store in `SessionState`.
- Add admin HTTP route: `GET /admin/online` — returns `OnlineVisitor[]` for all current sessions.

### New: `src/routes/api/admin/online/+server.ts`

- `GET` handler: validate admin JWT via `requireAdminAuth()`, then proxy to `ChatRoom DO /admin/online`.

## Frontend Changes

### `src/routes/download/+page.svelte`

- On mount: open a WebSocket to `/api/chat/ws` (silent visitor connection, no messages sent).
- On destroy: close the WebSocket.

### New: `src/lib/components/OnlineVisitors.svelte`

- Polls `GET /api/admin/online` every 5 seconds.
- Displays a table: IP, simplified browser name, connected duration, nickname.
- Shows total online count in header.
- Matches existing admin panel aesthetic (anime-cute, purple/pink palette).

### `src/routes/admin/+page.svelte`

- Add `'visitors'` to the tab union type.
- Add "在线用户" tab button.
- Render `<OnlineVisitors token={adminToken} />` when tab is active.

## Error Handling

- If the DO is unavailable, `/api/admin/online` returns 503; admin component shows error state.
- Visitor WebSocket failure on download page is silent (no UX disruption).

## Out of Scope

- Geo-location lookup from IP
- Persistent visitor history / analytics
- Per-visitor session replay
