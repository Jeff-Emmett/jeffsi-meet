# Breakout rooms × JMJMJ identity — design note (north star)

Companion to [`breakout-rooms-integration.md`](./breakout-rooms-integration.md).
That doc describes the **Zoom-parity** breakout features and the embedder
contract as shipped. This doc describes where we take them next: making a
breakout room a **cryptographically real** object whose membership is a set of
DIDs, backed by rspace-online's EncryptID identities and the JMJMJ
(Janus / Mercury / Morpheus) substrate.

Tracked as backlog **EPIC TASK-470** in `rspace-online`.

## The one-line idea

> A breakout room *is* a `HolonEnvelope` whose `audience` is the set of member
> DIDs. Everything the room produces (recording, transcript, MI holon) is
> encrypted to exactly that audience; membership becomes cryptographic, not
> cosmetic.

## Where we are

- Jitsi ships **native breakout rooms** (`react/features/breakout-rooms/` +
  Prosody `muc_breakout_rooms`). No external library is involved or needed.
- The `feat/breakout-zoom-parity` work added the Zoom-parity layer: moderator
  broadcast, timer + auto-return, ask-for-help, shuffle, self-select gating,
  pre-assignment, and per-room auto-record with a JMM envelope passthrough.
- **Identity today is a display-name string.** rMeets decodes the EncryptID
  JWT client-side only to extract `displayName`; **Prosody runs anonymous**
  (no token auth). So no cryptographic identity currently reaches the
  conference server.

## Two layers of assurance

Everything below sorts into one of two layers. Do Layer A first — it delivers
most of the value with no conference-server change.

| | Layer A — rMeets orchestration | Layer B — crypto identity at Prosody |
|---|---|---|
| Where | rspace-online rMeets (JS) + `envelopeHint` | Prosody EncryptID-capability auth + `muc_breakout_rooms` |
| Enforced by | rMeets + Morpheus (encryption-at-rest) | Prosody (server-side join/affiliation) |
| Jitsi/Prosody change | none | `mod_auth_encryptid` (EdDSA/did:key), module changes |
| Trust model | rMeets is trusted to assign correctly | server *verifies* the DID claim |
| Cost | low | high |

Layer A is advisory at the live-conference layer but the **encryption-at-rest is
real** — a non-member cannot decrypt a room's holon regardless of what the
conference server believes. Layer B closes the live-enforcement gap (who may
*join* a breakout MUC, who is *really* a moderator).

## Identity model (grounded in rspace-online)

- A participant identity is a **`did:key:z6Mk…`** (Ed25519 public key;
  `shared/addressing-keys.ts`). "The address IS the DID."
- EncryptID JWT → DID via `deriveCallerDid(claims)` = `claims.did` ||
  `claims.sub` (if `did:`) || derived; anonymous callers get `did:anon:<hash>`.
- The user account is itself a holon at `holon://identity/{did}`
  (`shared/jmjmj/identity-holon.ts`), envelope `sensitivity: 'encrypted'`.

## The `HolonEnvelope` (the room's access object)

```ts
interface HolonEnvelope {
  sensitivity: 'public'|'metadata-only'|'encrypted'|'zk-attested'|'tee-bound';
  computeTier: 'js-shared'|'rust-sidecar'|'tee'|'zk-circuit';
  audience:    readonly string[];   // DIDs / tokens; ['*']=public; []=publisher-only
  retention:   'ephemeral'|'session'|'persistent'|'permanent';
  jurisdiction?: string;            // ISO-3166-1 alpha-2
  proofAssurance?: ProofAssurance;
}
```

`audience` is a **grammar**, not just literal DIDs (`shared/jmjmj/expand-audience.ts`):

| token | expands to |
|---|---|
| `'*'` | public (only `'*'` is public; `[]`/DIDs are private, fail-closed) |
| `did:…` | that recipient DID |
| `space:{slug}` / `space:*` | member DIDs of that space membrane |
| `holon:{uri}:up\|down\|across` | owner DIDs of ancestors / descendants / peers |
| `geofence:{id}` | readers holding an unexpired zk residency claim |
| unknown | **skipped** (never widened — fail-closed) |

Enforcement is by **encryption to audience** (`shared/morpheus/store-ipfs-encrypted-kem.ts`):
per-recipient X25519 ECDH → HKDF → AES-256-GCM content-key wrap (wire magic
`rspaceK1`). **The recipient set is sealed at encrypt time** — moving a member
into a room re-encrypts *new* segments to the new set; already-written segments
stay encrypted to the old set (correct forward/backward secrecy for sub-room
membership).

## Affordances (the epic, in brief)

1. **DID-keyed pre-assignment** *(Layer A)* — rMeets computes DID→room from
   `meetingAudienceTokens()` / `space-membership` roster and emits
   `apply-breakout-assignments`; the Jitsi matcher gains a `did` field
   (`react/features/breakout-rooms/middleware.ts`).
2. **Room = audience** *(Layer A, highest leverage)* — each breakout's
   `envelopeHint.audience = memberDIDs`; Morpheus KEM-encrypts that room's
   MI/recording holon to exactly those DIDs.
3. **Audience-token auto-split** *(Layer A)* — feed N audience tokens
   (`space:`, `holon:…:down`, `geofence:`) → `expandAudience` → DID sets →
   assignment. Split by working group / rgov role / geofence, not by typed names.
4. **zk-attested / capability-gated self-select** *(frontier)* — enter a gated
   breakout only by presenting a zk proof of a claim, verified without
   revealing identity (`sensitivity: 'zk-attested'`). Ties to the ZK
   disclosure substrate (`TASK-HIGH.64`).
5. **Pseudonymous-but-accountable rooms** *(frontier)* — join under
   `did:anon`/a rotating handle; the DID→identity binding is a
   restricted-audience holon (moderator-only or none).
6. **Signed moderator intents** *(integrity)* — Ed25519-sign broadcast/help/
   timer payloads by the moderator DID so the cross-MUC fan-out can verify
   authenticity before injection.
7. **Per-room governance envelope** *(compliance by construction)* — each room
   differs in `jurisdiction`/`retention`/`computeTier`; Morpheus routes per
   room (EU→TEE/`session`, public→plaintext/`permanent`).

## Layer B — cryptographic identity at Prosody (pure EncryptID keys)

**No separate JWT key.** We do *not* introduce a JAAS app-secret or ASAP RSA
keyserver — that would be a second key hierarchy alongside EncryptID's Ed25519
`did:key`s. Instead we keep the JWT *envelope* (so lib-jitsi-meet/Prosody consume
it unmodified) but sign it with an **EncryptID Ed25519 key** (`alg: EdDSA`), and
the `kid` **is** the signer's `did:key` — self-describing, so Prosody resolves
the public key with the same `decodeDidKeyEd25519` used by the KEM (`.5`) and
intent signing (`.6`). One key type everywhere.

The token is a **capability, not a self-asserted identity**: it's signed by the
meeting *authority* (host DID / rMeets service DID) attesting "DID X may join
room R as role Y until T" — rspace's existing capability model
(`shared/capability/signature.ts` `signCP`/`verifyCPSignatureFromDID`).

1. rMeets **mints an EdDSA capability token** with the meeting-authority
   EncryptID key: header `{alg:EdDSA, kid:<authority did:key>}`, claims
   `{iss:<authorityDID>, sub:<userDID>, room, context.user.id=<userDID>,
   moderator, exp, nbf}`. Forwarded via `JitsiMeetExternalAPI`'s `jwt` option.
2. Prosody **`mod_auth_encryptid`** verifies: `decodeDidKeyEd25519(kid)` →
   authority pubkey → EdDSA verify → `iss` trusted for the room's space
   (`space-membership`) → room/exp checks. Recommended impl: a **verifier
   sidecar** delegating to an rspace HTTP endpoint that reuses the TS
   `verifyCPSignatureFromDID`/`decodeDidKeyEd25519` (DRY; shared with `.7`),
   not a parallel Lua reimplementation. Anonymous localvibe stays behind a flag.
3. jeffsi-meet reads the **verified** DID from `base/jwt` (`context.user.id` →
   `participant.jwtId`) and feeds the matcher. `validateJwt` must be relaxed to
   accept `EdDSA`+`did:key` (Prosody is authoritative).
4. `muc_breakout_rooms` **enforces membership**: deny join unless the
   participant DID is in the room audience/allowlist (moderator override).
5. **Verified moderator** affiliation derives from the capability's `moderator`
   claim; fan-out and moderator UI actions require a verified-moderator DID.

## Threat model (what Layer B buys, and what it doesn't)

| Threat | Layer A | Layer B |
|---|---|---|
| Non-member reads a room's transcript at rest | **blocked** (KEM) | blocked |
| Non-member *joins* the live breakout MUC | advisory only | **blocked** |
| Client spoofs "moderator broadcast" into all rooms | mitigated by signed intents | **blocked** (verified affiliation) |
| Assignment tampered client-side | possible (rMeets trusts input) | **blocked** (server verifies claim) |
| `audience` accidentally widened | fail-closed grammar | fail-closed grammar |
| JWT replay / expiry | n/a | reviewed (`TASK-HIGH.77`) |

## Config surfaces touched

- jeffsi-meet: `react/features/base/config/configType.ts` — `breakoutRooms`
  (`allowSelfSelect`, `autoRecord`, `envelopeHint`); `react/features/base/jwt/`.
- rMeets: `modules/rmeets/mod.ts` (`meetingAudienceTokens`, capability-token mint, envelope),
  `modules/rmeets/components/folk-jitsi-room.ts` (breakout attributes, events).
- Prosody: `mod_auth_encryptid` (EdDSA/did:key capability) + `muc_breakout_rooms` join/affiliation enforcement.

## Signed moderator intent — wire format (TASK-470.6)

Moderator broadcast/help/timer intents fan out across breakout MUCs
server-side (Jitsi has no native cross-MUC delivery — see
`doc/breakout-rooms-integration.md`), so an unsigned intent's `senderId` is
just untrusted client metadata. `rspace-online`'s
`modules/rmeets/breakout-intent-sign.ts` signs/verifies these with the
moderator's Ed25519 `did:key` before the fan-out (`.7`) will inject anything.

- **Shape**: any intent payload object plus two reserved fields —
  `senderDid` (the moderator's `did:key:z...`) and `sig` (base64 Ed25519
  signature, 64 bytes decoded). Caller-supplied `senderDid`/`sig` on the input
  payload are stripped before signing so they can't shadow the real ones.
- **Signed bytes**: canonical JSON — object keys recursively sorted,
  `undefined` entries dropped, no whitespace — of the payload **with**
  `senderDid` merged in and `sig` absent. Binding `senderDid` into the signed
  bytes means a valid signature can't be replayed under a different sender.
- **Verification** (`verifyBreakoutIntent`): rejects (status `'unverified'`,
  with reason) a missing `senderDid`, missing/non-string/malformed-base64/
  wrong-length `sig`, a `senderDid` that isn't an Ed25519 `did:key`, or a
  signature that doesn't match; only an `ed25519.verify` pass over the same
  canonical-bytes recipe returns `{ status: 'verified', signerDid }`. The
  fan-out (`.7`) refuses to inject anything that isn't `verified`.

## Related

- `TASK-470` (epic) and its Phase children in `rspace-online` backlog.
- `TASK-328` — JMJMJ auth + private transport.
- `TASK-HIGH.64` — ZK disclosure substrate (powers affordance 4).
- `TASK-HIGH.77` — JWT/session pentest (powers Layer-B security review).
- `TASK-277` — rmeets transcript aspect resolver.
