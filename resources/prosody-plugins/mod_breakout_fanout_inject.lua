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
--   -H "content-type: application/json" -H "authorization: Bearer {token}"

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
