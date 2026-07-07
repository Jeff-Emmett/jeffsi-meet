# Prosody EncryptID capability auth — wiring + validation (TASK-470.9/.11)

How the pure-EncryptID (Ed25519 `did:key`) capability tokens minted by rMeets
(`modules/rmeets/jitsi-capability-token.ts`, TASK-470.8) are verified by Prosody,
and how breakout-room membership is enforced. See
[`breakout-jmjmj-identity.md`](./breakout-jmjmj-identity.md) for the overall
Layer-B design.

> ⚠️ **The Lua changes here are UNVALIDATED against a live Prosody.** They must
> pass the [staging checklist](#staging-validation-checklist) before being
> enabled in any deployed config. The token verifier is on the critical join
> path — a wrong verify silently breaks every meeting join. Nothing in this doc
> is wired into the live config yet; the deployment stays on anonymous auth
> until validated.

## Design: one service authority, in-process verify

- **rMeets is the single token authority.** One service Ed25519 key (the rMeets
  service `did:key`) signs *all* capability tokens. rMeets does the real policy
  (is this user the host? a space moderator? allowed in this room? — from the
  meeting record + `space-membership`) and encodes the result as claims.
- **Prosody trusts exactly one public key** — the service `did:key`'s Ed25519
  pubkey — and only checks the signature + `room`/`exp`. No per-user keys, no
  `did:key` decode at runtime, no HTTP in the auth path (so Jitsi auth does **not**
  depend on rspace uptime — the reason we did *not* use a verifier sidecar for
  auth). Policy lives in rMeets; Prosody is a signature gate.

This keeps one Ed25519 hierarchy end-to-end and avoids the availability coupling
a sidecar would introduce.

## 1. EdDSA support in the JWT verifier (done, additive)

`resources/prosody-plugins/luajwtjitsi.lib.lua` gained `alg_sign['EdDSA']` /
`alg_verify['EdDSA']` via luaossl `pkey:sign/verify` (Ed25519 is one-shot — the
raw signing input, no digest). **Additive** — the HS*/RS* paths are untouched;
EdDSA runs only for tokens with `alg: EdDSA`. Requires luaossl built against
OpenSSL 1.1.1+.

## 2. Token verification config

The stock `mod_token_verification` + `token/util.lib.lua` path is reused; it
defaults `signatureAlgorithm = 'RS256'`, so configure EdDSA + the service pubkey:

```lua
-- prosody virtualhost (jeffsi) — NOT enabled until staging-validated
authentication = "token"
app_id = "jitsi"                                    -- must match token `aud`
asap_accepted_issuers = { "<rMeets service did:key>" } -- token `iss`
asap_accepted_audiences = { "jitsi" }
signature_algorithm = "EdDSA"
-- the service did:key's Ed25519 public key, PEM (SubjectPublicKeyInfo):
asap_key_path = "/config/encryptid-service-ed25519.pub.pem"
```

`iss` = the service `did:key`; the configured PEM is that key's Ed25519 pubkey
(derive once from the `did:key` at deploy time — `decodeDidKeyEd25519` → SPKI
PEM). `token/util.lib.lua` may need a small change to load a static EdDSA pubkey
by path rather than fetch by `kid` from an ASAP keyserver — validate on staging.

## 3. rMeets mint call-site (TASK-470.8 remaining)

At meeting join, rMeets mints the token with the service key and forwards it:

```ts
const token = mintJitsiCapabilityToken({
  authorityDid: SERVICE_DID,            // rMeets service did:key
  subjectDid: callerDid,                // the user's EncryptID DID
  room: roomName,
  moderator: isHostOrSpaceModerator(callerDid, meeting, space),
  displayName, nowMs: Date.now(),
}, SERVICE_ED25519_SEED);               // service private key (Infisical)
// → JitsiMeetExternalAPI({ ..., jwt: token })
```

The service private key is a deployment secret (Infisical), never shipped to the
browser. `context.user.id = subjectDid` propagates to `participant.jwtId`,
feeding the `.4` DID matcher; `moderator` sets the affiliation.

## 4. Client validation (TASK-470.10)

jeffsi-meet `react/features/base/jwt/functions.ts` `validateJwt` expects an
ASAP-style `kid` (`kid.indexOf('/')`) and RS/ES algorithms; it will flag the
EdDSA + `did:key`/`iss` token. Relax it to accept `alg: EdDSA` with `iss` as the
key reference (Prosody is authoritative; client validation is UX only) so the
token passes through and the DID lands in `context.user.id`.

## 5. Join enforcement (TASK-470.11)

`resources/prosody-plugins/mod_muc_breakout_rooms.lua`: on a breakout-room join,
deny unless the joining DID (`session.jitsi_meet_context_user.id`, from the
verified token) is in that room's audience/allowlist — the same
`Meeting.breakoutAssignments` set that scopes the KEM audience (TASK-470.5/.19).
The host is always allowed (override). Emit denial telemetry. Implement as a
`muc-occupant-pre-join` hook; validate that the token context is populated at
that point in the join sequence.

## Staging validation checklist

Before enabling in any deployed config:

- [ ] luaossl in the jeffsi Prosody image does Ed25519 `pkey:sign`/`verify`
      (one-shot, raw input) — round-trip a token minted by
      `jitsi-capability-token.ts` against `verifyEdDSA`.
- [ ] `mint` → join a real room with `authentication="token"` on a staging host;
      confirm accept for a valid token, reject for tampered/expired/wrong-issuer.
- [ ] `context.user.id` (the DID) is populated on the remote participant
      (`jwtId`) — confirms `.4` matching works end-to-end.
- [ ] moderator affiliation is granted only when the token's `moderator` claim
      is set.
- [ ] breakout join is denied for a DID not in the room assignment; allowed for
      one that is; host override works.
- [ ] anonymous fallback still works when `authentication` is left unset (no
      regression to the current localvibe behavior).
```
