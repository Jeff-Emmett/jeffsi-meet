-- TASK-470.7 — cross-MUC breakout fan-out injection bridge.
--
-- rMeets' `POST /api/meetings/:id/breakout-fanout` (rspace-online) already
-- verifies a moderator's signed broadcast/help/timer intent (Ed25519
-- signature + freshness + moderator authority — see breakout-fanout.ts) and
-- computes the delivery PLAN: which breakout-room MUCs should receive the
-- payload. Jitsi/Prosody has no native cross-MUC delivery, so this module is
-- the last-mile bridge: rMeets POSTs the already-verified plan here, and this
-- module actually broadcasts the payload into each target room as a
-- room-wide `json-message` — the same wire format the breakout-rooms client
-- code already listens for (see doc/breakout-rooms-integration.md).
--
-- This endpoint is a trusted rMeets->Prosody bridge and MUST be
-- network-isolated (bound to localhost / an internal network only) in any
-- real deployment — it is never internet-reachable. The Bearer-token check
-- below is defense-in-depth on top of that isolation, matching this
-- codebase's existing convention (mod_system_chat_message.lua).
--
-- curl http://127.0.0.1:{port}/breakout-fanout-inject \
--   -d '{"targets":[{"roomJid":"room1@conference.example.com","payload":{"type":"breakout-broadcast","message":"back in 2"}}]}' \
--   -H "content-type: application/json" -H "authorization: Bearer {token}" \
--   -H "x-breakout-dedupe-key: {sig}"
--
-- TASK-470.7 AC3 (idempotent + late joiners get the current timer):
--   - Idempotency: rMeets signs each intent with deterministic EdDSA, so a
--     client retry (network timeout, double-click) re-POSTs the IDENTICAL
--     signature as `x-breakout-dedupe-key` (see rspace-online
--     breakout-fanout.ts's `FanoutDecision.dedupeKey` doc comment). A key
--     seen within `DEDUPE_TTL_SEC` is treated as a repeat: every target for
--     that request is counted as `skipped`, nothing is (re-)broadcast.
--   - Late-joiner timer: whenever an injected payload is a
--     `breakout-timer-update`, its `{endTimestamp, durationMs}` is
--     remembered per room jid (cleared on `endTimestamp == nil`, i.e. the
--     client's clear-timer payload) in a `module:shared` table. The actual
--     unicast-on-join lives in `mod_muc_breakout_late_joiner_timer.lua` —
--     THIS module is only ever loaded on the `meet.jitsi` VirtualHost
--     (`XMPP_MODULES`) for its HTTP endpoint, which is a different host than
--     the MUC components (`XMPP_MUC_MODULES`/`XMPP_BREAKOUT_MUC_MODULES`)
--     `muc-occupant-joined` actually fires on — a `module:hook` for that
--     event here would silently never run (found empirically: staging-tested
--     via a real hand-rolled client join, no unicast ever arrived, root-caused
--     to this exact host mismatch rather than assumed working from code
--     review alone). `module:shared(...)` is what lets the two module
--     instances, loaded on different hosts, see the same timer state.

local util = module:require "util";
local token_util = module:require "token/util".new(module);

local async_handler_wrapper = util.async_handler_wrapper;
local starts_with = util.starts_with;
local get_room_from_jid = util.get_room_from_jid;
local is_admin = util.is_admin;

local st = require "util.stanza";
local json = require "cjson.safe";

local asapKeyServer = module:get_option_string("prosody_password_public_key_repo_url", "");

if asapKeyServer then
    token_util:set_asap_key_server(asapKeyServer)
end

-- Dedup window: a little wider than rMeets' own 60s intent-freshness window
-- (breakout-fanout.ts isIntentFresh maxAgeMs) so any client retry inside
-- that freshness window is guaranteed to still be recognised here.
local DEDUPE_TTL_SEC = 90;
-- recently_injected[dedupe_key] = os.time() when last seen. Not shared: only
-- this HTTP-handling instance ever writes/reads it.
local recently_injected = {};
-- current_timers[room_jid] = { endTimestamp = <ms>, durationMs = <ms>, payload = <table> }.
-- SHARED (not `local`) with mod_muc_breakout_late_joiner_timer.lua, which is
-- loaded on the MUC component hosts and does the actual unicast-on-join —
-- see the file-level doc comment for why this can't be one module/one hook.
-- The "/*/" prefix requests Prosody's GLOBAL (cross-host) shared-table scope
-- — a bare key (no leading slash) is scoped to only the CURRENT host, which
-- would silently give this module and mod_muc_breakout_late_joiner_timer.lua
-- (a different host) two independent, never-synced tables. Found empirically
-- (debug logging showed `remember_timer` writing the key here while the
-- other module's `known_keys` read back consistently empty) after fixing the
-- host-mismatch bug once already wasn't enough on its own.
local current_timers = module:shared("/*/breakout_fanout_inject/current_timers");

local function prune_recently_injected(now)
    for key, seen_at in pairs(recently_injected) do
        if now - seen_at > DEDUPE_TTL_SEC then
            recently_injected[key] = nil;
        end
    end
end

-- Returns true (and records the key) exactly once per DEDUPE_TTL_SEC window;
-- a nil/empty key never dedupes (fail-open to "always inject" rather than
-- silently dropping an unkeyed request).
local function claim_dedupe_key(dedupe_key)
    if not dedupe_key or dedupe_key == "" then
        return true;
    end

    local now = os.time();
    prune_recently_injected(now);

    if recently_injected[dedupe_key] then
        return false;
    end
    recently_injected[dedupe_key] = now;
    return true;
end

-- Remembers (or clears) the current timer for a room from an injected
-- payload, so a late joiner can be caught up. Only acts on
-- breakout-timer-update payloads; anything else is left untouched.
local function remember_timer(room_jid, payload)
    if payload.type ~= "breakout-timer-update" then
        return;
    end
    if payload.endTimestamp == nil or payload.endTimestamp == json.null then
        current_timers[room_jid] = nil;
        return;
    end
    current_timers[room_jid] = {
        endTimestamp = payload.endTimestamp;
        durationMs = payload.durationMs;
        payload = payload;
    };
end

function verify_token(token)
    if token == nil then
        module:log("warn", "no token provided");
        return false;
    end

    local session = {};
    session.auth_token = token;
    local verified, reason, msg = token_util:process_and_verify_token(session);
    if not verified then
        module:log("warn", "breakout-fanout-inject: not a valid token %s %s", tostring(reason), tostring(msg));
        return false;
    end
    return true;
end

-- Broadcasts `payload` (already-encoded JSON string) as a room-wide
-- json-message to every occupant of `room` — mirrors the exact pattern
-- mod_filesharing_component.lua already uses for room-wide event broadcast:
-- one template stanza, cloned + re-addressed per occupant (a stanza object
-- is consumed once sent, so each recipient needs its own clone).
local function broadcast_to_room(room, json_msg)
    local stanza = st.message({ from = module.host })
        :tag('json-message', { xmlns = 'http://jitsi.org/jitmeet' })
        :text(json_msg)
        :up();

    local count = 0;

    for _, room_occupant in room:each_occupant() do
        if not is_admin(room_occupant.bare_jid) then
            local to_send = st.clone(stanza);
            to_send.attr.to = room_occupant.jid;
            module:send(to_send);
            count = count + 1;
        end
    end

    return count;
end

function handle_breakout_fanout_inject(event)
    local request = event.request;

    if request.headers.content_type ~= "application/json"
            or (not request.body or #request.body == 0) then
        module:log("error", "breakout-fanout-inject: wrong content type: %s or missing payload",
            request.headers.content_type);
        return { status_code = 400; };
    end

    -- Auth check (defense-in-depth; this endpoint must be network-isolated regardless).
    local token = request.headers["authorization"];
    if not token then
        module:log("error", "breakout-fanout-inject: authorization header missing");
        return { status_code = 401; };
    end
    if starts_with(token, 'Bearer ') then
        token = token:sub(8, #token);
    else
        module:log("error", "breakout-fanout-inject: authorization header invalid");
        return { status_code = 401; };
    end
    if not verify_token(token) then
        return { status_code = 401; };
    end

    local body, err = json.decode(request.body);
    if not body or not body.targets then
        module:log("error", "breakout-fanout-inject: invalid body: %s", tostring(err));
        return { status_code = 400; };
    end

    local injected = 0;
    local skipped = 0;

    -- Idempotency (TASK-470.7 AC3): a repeated dedupe key within the TTL
    -- window skips every target for this request outright — no partial
    -- re-injection, no re-arming of the late-joiner timer state either
    -- (remember_timer only runs on a claimed, non-duplicate request).
    -- Prosody's HTTP request.headers normalizes hyphenated header names to
    -- underscored field names (matches this file's own `content_type` access
    -- for the "Content-Type" header above) -- a bracket lookup with the
    -- literal hyphenated string returns nil.
    local dedupe_key = request.headers.x_breakout_dedupe_key;
    local is_duplicate = not claim_dedupe_key(dedupe_key);

    if is_duplicate then
        module:log("info", "breakout-fanout-inject: duplicate dedupe key %s, skipping %d target(s)",
            tostring(dedupe_key), #body.targets);
        return {
            status_code = 200;
            headers = { content_type = "application/json" };
            body = json.encode({ injected = 0; skipped = #body.targets; deduped = true });
        };
    end

    for _, target in ipairs(body.targets) do
        local room_jid = target.roomJid;
        local payload = target.payload;

        if not room_jid or not payload then
            module:log("warn", "breakout-fanout-inject: target missing roomJid/payload, skipping");
            skipped = skipped + 1;
        else
            local room = get_room_from_jid(room_jid);

            if not room then
                module:log("warn", "breakout-fanout-inject: room %s not found, skipping", room_jid);
                skipped = skipped + 1;
            else
                local json_msg, encode_err = json.encode(payload);

                if not json_msg then
                    module:log("error", "breakout-fanout-inject: payload encode failed for %s: %s",
                        room_jid, tostring(encode_err));
                    skipped = skipped + 1;
                else
                    broadcast_to_room(room, json_msg);
                    remember_timer(room_jid, payload);
                    injected = injected + 1;
                end
            end
        end
    end

    return {
        status_code = 200;
        headers = { content_type = "application/json" };
        body = json.encode({ injected = injected; skipped = skipped });
    };
end

module:log("info", "Adding http handler for /breakout-fanout-inject on %s", module.host);
module:depends("http");
module:provides("http", {
    default_path = "/";
    route = {
        ["POST breakout-fanout-inject"] = function(event)
            return async_handler_wrapper(event, handle_breakout_fanout_inject)
        end;
    };
});
