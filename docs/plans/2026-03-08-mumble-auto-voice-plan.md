# Mumble Auto Voice State Machine Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the page auto-join voice on load with the microphone muted by default, while keeping mute and text-only driven by a client-side state machine that survives reconnects.

**Architecture:** Extend `createMumbleClient` so it owns the local voice intent (`voiceRequested`, `muted`, `deafened`) and replays that intent across `connect()`, `connected`, and reconnect flows. Keep `MumbleWidget` thin: it boots the client in auto-voice mode, renders stronger “not broadcasting yet” copy, and calls client methods without maintaining a second voice state source.

**Tech Stack:** TypeScript, Svelte 5 runes, SvelteKit 2, WebSocket/WebRTC, `node:test`

---

### Task 1: Auto-request voice and start muted by default

**Files:**
- Modify: `src/lib/mumble/client.test.ts:135-220`
- Modify: `src/lib/mumble/client.ts:427-478, 529-557, 639-687`
- Reference: `docs/plans/2026-03-08-mumble-auto-voice-design.md`

**Step 1: Write the failing test**

Replace the current “waits for explicit voice enable” expectation with a test that proves an interactive client automatically requests local audio on first connect and keeps the microphone track disabled by default.

```ts
test('interactive connect auto-requests voice and starts muted by default', async () => {
const track = new FakeMediaStreamTrack();
const localStream = new FakeMediaStream([track]);
let getUserMediaCalls = 0;

const client = createMumbleClient({ config, nickname: 'TestUser', mode: 'interactive' });
client.connect();
// ...emit connected...

assert.equal(getUserMediaCalls, 1);
assert.equal(FakeRTCPeerConnection.instances.length, 1);
assert.equal(track.enabled, false);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/lib/mumble/client.test.ts --test-name-pattern "auto-requests voice"`
Expected: FAIL because `getUserMediaCalls` is still `0` and no peer connection is created on plain `client.connect()`.

**Step 3: Write minimal implementation**

Update the initial interactive snapshot and connect lifecycle so auto-voice is the default intent instead of an opt-in flag.

```ts
export function createInitialMumbleClientSnapshot(): MumbleClientSnapshot {
return {
// ...
muted: true,
deafened: false,
voiceRequested: true,
// ...
};
}

function connect(connectOptions?: ConnectOptions): void {
pendingVoiceRequest =
mode === 'interactive' && (connectOptions?.requestVoice ?? snapshot.voiceRequested);
// ...
}

case 'connected': {
if (mode === 'interactive' && pendingVoiceRequest) {
pendingVoiceRequest = false;
await ensureVoice();
}
}
```

Also make sure `ensureVoice()` respects the stored `muted` intent before or immediately after acquiring tracks.

**Step 4: Run test to verify it passes**

Run: `node --test src/lib/mumble/client.test.ts --test-name-pattern "auto-requests voice"`
Expected: PASS with one `getUserMedia` call, one peer connection, and the local track still disabled.

**Step 5: Commit**

```bash
git add src/lib/mumble/client.ts src/lib/mumble/client.test.ts
git commit -m "feat: auto request mumble voice on connect" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 2: Make mute and text-only owned by local client state

**Files:**
- Modify: `src/lib/mumble/client.test.ts:245-360`
- Modify: `src/lib/mumble/client.ts:220-231, 523-636, 823-845`

**Step 1: Write the failing test**

Add a focused test proving that once the local client toggles mute/deafen, a later `user_state` event for the current session does not overwrite those local button states.

```ts
test('local mute and deafen are not overwritten by self user_state events', async () => {
const client = createMumbleClient({ config, nickname: 'TestUser', mode: 'interactive' });
const snapshots: MumbleClientSnapshot[] = [];
const unsubscribe = client.state.subscribe((value) => snapshots.push(value));

client.connect();
// ...emit connected for session_id 1...
client.setMuted(false);
client.setDeafened(true);
socket.receive({
type: 'user_state',
data: { session_id: 1, mute: true, deaf: false, self_mute: true, self_deaf: false }
});

assert.equal(snapshots.at(-1)?.muted, false);
assert.equal(snapshots.at(-1)?.deafened, true);
unsubscribe();
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/lib/mumble/client.test.ts --test-name-pattern "not overwritten by self user_state"`
Expected: FAIL because the current `user_state` branch rewrites `muted` and `deafened` through `updateUsers()` for the active session.

**Step 3: Write minimal implementation**

Split “server facts” from “local voice intent” when processing the active session.

```ts
function updateUsers(users: MumbleUser[]): void {
const self = snapshot.sessionId
? users.find((user) => user.sessionId === snapshot.sessionId) ?? null
: null;

patch({
users,
onlineCount: users.length,
currentChannelId: self?.channelId ?? snapshot.currentChannelId
// do not mirror self mute/deafen back into local controls here
});
}

case 'user_state': {
const isSelf = parsed.data.session_id === snapshot.sessionId;
const nextUsers = snapshot.users.map((user) =>
user.sessionId === parsed.data.session_id
? {
...user,
...(parsed.data.channel_id != null && { channelId: parsed.data.channel_id }),
...(parsed.data.name != null && { name: sanitizeString(parsed.data.name, 32) }),
...(!isSelf && parsed.data.mute != null && { muted: parsed.data.mute }),
...(!isSelf && parsed.data.deaf != null && { deafened: parsed.data.deaf }),
...(!isSelf && parsed.data.self_mute != null && { selfMuted: parsed.data.self_mute }),
...(!isSelf && parsed.data.self_deaf != null && { selfDeafened: parsed.data.self_deaf })
  }
: user
);
updateUsers(nextUsers);
}
```

Leave `setMuted()` and `setDeafened()` as the authoritative place that patches local store state, updates tracks/audio elements, and emits WebSocket commands.

**Step 4: Run test to verify it passes**

Run: `node --test src/lib/mumble/client.test.ts --test-name-pattern "not overwritten by self user_state"`
Expected: PASS with the final snapshot still showing the locally selected mute/deafen values.

**Step 5: Commit**

```bash
git add src/lib/mumble/client.ts src/lib/mumble/client.test.ts
git commit -m "fix: keep mumble voice controls client-owned" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 3: Preserve and replay local voice intent across reconnects

**Files:**
- Modify: `src/lib/mumble/client.test.ts:245-360`
- Modify: `src/lib/mumble/client.ts:480-520, 689-747, 794-845`

**Step 1: Write the failing test**

Extend the reconnect coverage so the client proves it keeps the pre-disconnect mute/deafen intent and reuses it after the new socket connects.

```ts
test('reconnect preserves local mute and text-only intent', async () => {
const track = new FakeMediaStreamTrack();
const client = createMumbleClient({ config, nickname: 'TestUser', mode: 'interactive' });

client.connect();
// ...connected on socket 1...
client.setMuted(false);
client.setDeafened(true);
client.reconnect();
firstSocket.completeClose('manual reconnect');
secondSocket.open();
secondSocket.receive(connectedPayload);
await flushAsyncWork();

assert.equal(track.enabled, true);
assert.equal(lastSnapshot?.deafened, true);
assert.match(secondSocket.sent.at(-1) ?? '', /"type":"deafen"/);
});
```

**Step 2: Run test to verify it fails**

Run: `node --test src/lib/mumble/client.test.ts --test-name-pattern "preserves local mute and text-only intent"`
Expected: FAIL because reconnect currently rebuilds the socket/peer connection without explicitly replaying the stored local intent.

**Step 3: Write minimal implementation**

Introduce a small helper that reapplies local audio preferences after voice setup and after reconnect success.

```ts
function applyLocalVoiceIntent(): void {
if (localStream) {
for (const track of localStream.getAudioTracks()) {
track.enabled = !snapshot.muted;
}
}

for (const audio of remoteAudioElements.values()) {
audio.muted = snapshot.deafened;
}

if (socket?.readyState === SOCKET_OPEN) {
sendEvent({ type: 'mute', data: { muted: snapshot.muted } });
sendEvent({ type: 'deafen', data: { deafened: snapshot.deafened } });
}
}
```

Call it from:
- `ensureVoice()` after tracks are available
- the `'connected'` branch after `ensureVoice()` / `ensurePeerConnection()` settles
- `setMuted()` / `setDeafened()` after patching so reconnect and steady-state paths share one rule set
- `rename()` / `reconnect()` flows only through preserved snapshot state, not hard-coded defaults

**Step 4: Run tests to verify they pass**

Run: `node --test src/lib/mumble/client.test.ts`
Expected: PASS for the reconnect regression plus the earlier auto-voice and self-`user_state` tests.

**Step 5: Commit**

```bash
git add src/lib/mumble/client.ts src/lib/mumble/client.test.ts
git commit -m "fix: replay mumble voice intent after reconnect" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 4: Update the widget to reflect automatic voice bootstrap and muted-default UX

**Files:**
- Modify: `src/lib/components/MumbleWidget.svelte:51-80`
- Modify: `src/lib/components/MumbleWidget.svelte:266-292`
- Modify: `src/lib/components/MumbleWidget.svelte:365-494`
- Reference: `src/lib/mumble/client.ts:427-478, 639-845`

**Step 1: Make the UI expectation explicit**

Adjust the widget copy so the status panel and controls assume voice is auto-bootstrapped and the main CTA is no longer “enable voice.” The UI should make it obvious that the user is connected but not speaking yet.

```svelte
const statusText = $derived.by(() => {
if (clientState.connected && clientState.voiceConnected && clientState.muted) {
return '文字和语音已连接，当前未开麦';
}
// ...existing states...
});
```

**Step 2: Run type-check to capture the current baseline**

Run: `npm run check`
Expected: PASS before UI copy changes, confirming the widget edits start from a green type-check baseline.

**Step 3: Write the minimal widget implementation**

Update the widget so it boots the client into the new auto-voice default and renders the clearer muted-state messaging.

```svelte
onMount(() => {
// ...create client...
client = createMumbleClient({ config, nickname, mode: 'interactive' });
unsubscribeClient = client.state.subscribe(handleSnapshot);
client.connect();
});

<button class="voice-btn" class:active={clientState.voiceConnected} type="button" onclick={() => void client?.ensureVoice()}>
{clientState.voiceConnected ? (clientState.muted ? '语音已连接（未开麦）' : '语音已启用') : '重新请求语音'}
</button>
```

Also add or adjust a visible hint card / status line so “默认静音” is obvious when `clientState.voiceConnected && clientState.muted`.

**Step 4: Run full verification**

Run: `npm run check && npm run build`
Expected: PASS with no Svelte/type errors and a successful production build.

**Step 5: Commit**

```bash
git add src/lib/components/MumbleWidget.svelte src/lib/mumble/client.ts src/lib/mumble/client.test.ts
git commit -m "feat: surface mumble auto voice muted state" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

### Task 5: Final regression pass and handoff notes

**Files:**
- Review only: `src/lib/mumble/client.ts`
- Review only: `src/lib/components/MumbleWidget.svelte`
- Review only: `src/lib/mumble/client.test.ts`
- Review only: `docs/plans/2026-03-08-mumble-auto-voice-design.md`

**Step 1: Re-run the narrow regression suite**

Run: `node --test src/lib/mumble/client.test.ts`
Expected: PASS for all Mumble client tests.

**Step 2: Re-run repository validation**

Run: `npm run check && npm run build`
Expected: PASS for both commands.

**Step 3: Review the diff for scope control**

Run: `git --no-pager diff -- src/lib/mumble/client.ts src/lib/components/MumbleWidget.svelte src/lib/mumble/client.test.ts`
Expected: Only the planned auto-voice/state-machine/UI changes appear; no unrelated refactors.

**Step 4: Summarize manual smoke checks**

Record these manual checks in the implementation handoff:
- Open the page and confirm the browser immediately requests microphone permission.
- After permission is granted, confirm the widget shows voice connected but not speaking yet.
- Toggle “麦克风静音” and “仅听文字,” force a reconnect, and confirm both choices persist.
- Refresh the page and confirm the defaults reset to auto-voice + muted + not text-only.

**Step 5: Commit final cleanups if needed**

```bash
git add src/lib/components/MumbleWidget.svelte src/lib/mumble/client.ts src/lib/mumble/client.test.ts
git commit -m "chore: finalize mumble auto voice regression coverage" -m "Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```
