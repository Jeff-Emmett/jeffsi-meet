# Breakout-rooms integration (Zoom-parity + rMeets / JMM)

This branch ships Zoom-style breakout-room features and an integration
contract for embedders that need per-room recording / Mycelial-Intelligence
processing — concretely the rMeets rApp in rspace-online.

The whole feature stays inside `react/features/breakout-rooms/` plus the
participants-pane web UI under
`react/features/participants-pane/components/breakout-rooms/components/web/`.

## Capabilities added on the Jitsi side

| Feature | Surface |
|---|---|
| Per-room iframe events | `breakoutRoomCreated`, `breakoutRoomRemoved`, `breakoutRoomJoined`, `breakoutRoomLeft`, `breakoutRoomHelpRequested`, `breakoutBroadcastReceived`, `breakoutTimerUpdated` |
| Moderator broadcast | UI button + `broadcastToBreakoutRooms()` action + `breakout-broadcast` iframe command |
| Ask-for-help | UI button visible only inside a breakout + `requestBreakoutHelp()` + `breakout-request-help` command |
| Timer + auto-return | UI button + countdown + `setBreakoutTimer(ms)` / `clearBreakoutTimer()` actions + 60s warning notification + `breakout-set-timer` / `breakout-clear-timer` commands |
| Shuffle | UI button + `shuffleBreakoutRooms()` action + `breakout-shuffle` command |
| Self-select gating | `breakoutRooms.allowSelfSelect` (default `true`); set `false` for moderator-only assignment |
| Pre-assignment | `?breakout-assignments=<base64-json>` URL param + `apply-breakout-assignments` iframe command |
| Per-room auto-record | `breakoutRooms.autoRecord: true` triggers `startRecording` on every conference join (main + each breakout) |
| JMM envelope passthrough | `breakoutRooms.envelopeHint` is forwarded inside `appData.file_recording_metadata.jmm_envelope` to the recording service |

## Wire format — moderator → in-room signalling

Broadcast / help / timer messages travel on the existing `<json-message>`
XMPP channel — they arrive at peers in the same MUC as
`ENDPOINT_MESSAGE_RECEIVED` actions with the following shapes:

```jsonc
// breakout-broadcast
{ "type": "breakout-broadcast", "message": "...",
  "senderId": "...", "senderName": "...", "timestamp": 1738700000000 }

// breakout-help-request
{ "type": "breakout-help-request",
  "roomId": "...", "roomName": "...", "roomJid": "...",
  "participantId": "...", "participantName": "...", "timestamp": 1738700000000 }

// breakout-timer-update
{ "type": "breakout-timer-update",
  "endTimestamp": 1738700300000, "durationMs": 300000 }
```

Cross-MUC delivery is **not native to Jitsi** — a participant in breakout
room A does not receive `<json-message>` traffic sent inside the main
room. To bridge that gap, the same payload also fires as an iframe API
event on the moderator's frame: `breakout-broadcast-send-requested`,
`breakout-help-request-sent`, `breakout-timer-set-requested`. An
embedder that controls the XMPP server (rMeets does, via Prosody +
breakout-rooms module) can fan out server-side using its own back-end.

## Pre-assignment URL format

```
https://meet.example.com/Room?breakout-assignments=eyJyb29tcyI6W3sibmFtZSI6Ik1pY3JvY29zbSBBIiwicGFydGljaXBhbnRzIjpbImFsaWNlIiwiYm9iIl19XX0
```

Where the decoded JSON is one of:

```jsonc
// canonical
{ "rooms": [
    { "name": "Microcosm A", "participants": ["alice", "bob"] },
    { "name": "Microcosm B", "participants": ["did:key:z6Mk…"] }
] }

// bare array — same content
[
  { "name": "Microcosm A", "participants": ["alice", "bob"] }
]

// flat / Zoom-style
{ "alice": "Microcosm A", "bob": "Microcosm A", "carol": "Microcosm B" }
```

Identifiers are matched against participant id, then email, then
displayName. Entries that don't match yet stay in
`state['features/breakout-rooms'].pendingAssignments`; the middleware
retries on every `UPDATE_BREAKOUT_ROOMS` and `PARTICIPANT_JOINED` so
late joiners and just-created rooms resolve automatically.

## JMM envelope passthrough — the recording side

When `breakoutRooms.autoRecord: true` and the local participant is a
moderator, every `CONFERENCE_JOINED` (main room + each breakout swap)
fires:

```ts
conference.startRecording({
  mode: JitsiRecordingConstants.mode.FILE,
  appData: JSON.stringify({
    file_recording_metadata: {
      share: false,
      jmm_envelope: cfg.envelopeHint, // schema below
      breakout_room: {
        roomId, name, jid, isBreakout
      }
    }
  })
});
```

The envelope hint mirrors the `HolonEnvelope` schema in
`rspace-online/shared/jmm/holon-envelope.ts`:

```ts
{
  sensitivity: 'public' | 'metadata-only' | 'encrypted'
              | 'zk-attested' | 'tee-bound',
  computeTier: 'js-shared' | 'rust-sidecar' | 'tee' | 'zk-circuit',
  audience:    string[],   // DIDs, or ['*'] for public
  retention:   'ephemeral' | 'session' | 'persistent' | 'permanent',
  jurisdiction?: string    // ISO-3166-1 alpha-2
}
```

## Embedder contract — what rMeets needs to do

The Jitsi side only **emits intent** for cross-room delivery and recording
fan-out. The rMeets module on the rspace-online side owns:

1. **One MI recorder per breakout.** Listen for `breakoutRoomCreated`,
   start an MI session keyed by `roomId`. Listen for `breakoutRoomRemoved`
   to stop. The auto-record event `breakout-room-auto-record-started`
   carries `roomId` + `envelopeHint` directly.

2. **Server-side broadcast / help-request fan-out.** Listen for
   `breakout-broadcast-send-requested` and post the message into each
   breakout MUC via Prosody admin. Same for `breakout-help-request-sent`
   (deliver to moderator JIDs only) and `breakout-timer-set-requested`
   (idempotent: a participant who already received the in-room
   `breakout-timer-update` will just no-op the second copy).

3. **Per-breakout MI Automerge tagging.** When MI returns transcripts
   for a breakout-recorded session, rMeets's `syncMeetingFromMI` should
   stamp the resulting holon with the `jmm_envelope` provided in the
   recording's appData so Morpheus routes the cached transcript to the
   right store (audience-restricted, not the default
   `ipfs-plaintext`).

4. **Pre-assignment plumbing.** rMeets can choose how it gets a Zoom-
   style assignment list to a meeting URL — either embed
   `?breakout-assignments=…` on the meeting share link, or call the
   `apply-breakout-assignments` iframe command after moderator join.

### Suggested rmeets/mod.ts wiring

```ts
// pseudo-code in rspace-online/modules/rmeets
const jitsiApi = new JitsiMeetExternalAPI(domain, opts);

jitsiApi.on('breakoutRoomCreated', ({ roomId, name, jid }) => {
  miClient.post('/meetings', {
    id: roomId,
    parent_meeting_id: parentRoomId,
    title: name,
    breakout: true
  });
});
jitsiApi.on('breakoutRoomRemoved', ({ roomId }) => {
  miClient.post(`/meetings/${roomId}/finalize`);
});
jitsiApi.on('breakoutRoomAutoRecordStarted', ({ roomId, envelopeHint }) => {
  miClient.post(`/meetings/${roomId}/envelope`, { envelope: envelopeHint });
});
```

## Files of interest in this repo

- `react/features/breakout-rooms/{actions,middleware,reducer,functions,constants,types}.ts`
- `react/features/participants-pane/components/breakout-rooms/components/web/`
  — `BroadcastButton.tsx`, `BreakoutBroadcastPrompt.tsx`,
  `AskForHelpButton.tsx`, `BreakoutTimerControls.tsx`,
  `BreakoutTimerPrompt.tsx`, `ShuffleButton.tsx`
- `modules/API/API.js` — new `notifyBreakout*` methods + new commands
- `modules/API/external/external_api.js` — events + commands maps
- `react/features/base/config/configType.ts` — `IConfig.breakoutRooms`
  extended with `allowSelfSelect`, `autoRecord`, `envelopeHint`
- `config.js` — documentation comments for the new keys
