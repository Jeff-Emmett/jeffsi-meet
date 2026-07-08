-- TASK-470.11 (breakout join enforcement by DID/audience) + TASK-470.12
-- (verified moderator authority), combined since they share the same
-- muc-occupant-pre-join / muc-occupant-joined hook pair — mirrors the exact
-- two-hook structure mod_muc_allowners.lua already uses for its own
-- token-driven promote-on-join flow (mark during pre-join, act on joined).
--
-- .11 — deny a breakout-room join unless the joining participant's VERIFIED
-- DID (session.jitsi_meet_context_user.id — populated by token/util.lib.lua
-- from the EdDSA capability token's context.user.id, see .8/.9) is in that
-- room's assigned audience. A verified MODERATOR is always allowed (override)
-- — this is the correct override condition, not "the host specifically", since
-- a moderator may be someone the host granted authority to via a signed
-- intent (.6/.7), not only the original host DID.
--
-- Per muc-occupant-pre-join's OWN documented semantics (see
-- mod_token_verification.lua: "Returning any value other than nil will halt
-- processing of the event"), denial is `return true` here, not `false`.
--
-- Room->DID-list lookup: for THIS session, a static config table
-- (`breakout_room_dids`, room JID -> array of allowed DIDs) is used rather
-- than a live fetch from rspace-online's Meeting.breakoutAssignments — that
-- live wiring (rMeets pushing the current assignment list into Prosody, or
-- Prosody pulling it) is deliberately deferred as separate follow-up work.
-- A room with NO entry in this table is NOT gated by this module at all
-- (falls through silently) — this module only restricts rooms an operator
-- has explicitly listed, never widens/guesses.
--
-- .12 — moderator affiliation is granted ONLY from the verified token's
-- context.user.moderator claim ('true'/'false' string, per
-- jitsi-capability-token.ts's claim shape) — never from any client-supplied
-- value. Uses the same mark-in-pre-join / act-in-joined pattern as
-- mod_muc_allowners.lua's room:set_affiliation(true, occupant.bare_jid, "owner").

local is_admin = module:require("util").is_admin;
local st = require "util.stanza";

local breakout_room_dids = {};
local function load_config()
    breakout_room_dids = module:get_option("breakout_room_dids", {});
end
load_config();

-- Occupants currently mid-join who should be promoted to moderator once
-- muc-occupant-joined fires (mirrors mod_muc_allowners.lua's
-- joining_moderator_participants pattern exactly).
local joining_moderator_participants = module:shared('breakout_did_gate/joining_moderator_participants');

-- Sends an explicit XEP-0045 error presence back to the denied occupant
-- before halting the event, mirroring mod_token_verification.lua's own
-- denial convention (st.error_reply + session.send). Without this, returning
-- non-nil from muc-occupant-pre-join silently drops the join with no
-- feedback — the client just hangs waiting for a response that never comes
-- (confirmed empirically in staging: the denial worked, but the connecting
-- client saw nothing until its own timeout).
local function deny(origin, stanza, reason)
    local response = st.error_reply(stanza, 'cancel', 'not-allowed', reason);
    origin.send(response);
end

module:hook("muc-occupant-pre-join", function(event)
    local room, occupant, origin, stanza = event.room, event.occupant, event.origin, event.stanza;

    if is_admin(occupant.bare_jid) then
        return; -- server-internal (e.g. jicofo/jibri) — never gated
    end

    local context_user = origin.jitsi_meet_context_user;
    local did = context_user and context_user.id;
    local is_verified_moderator = context_user and context_user.moderator == 'true';

    -- .11: room-DID gate. Only rooms an operator explicitly listed are
    -- gated; everything else falls through un-gated (see file doc comment).
    local allowed_dids = breakout_room_dids[room.jid];

    if allowed_dids and not is_verified_moderator then
        if not did then
            module:log('warn', 'breakout_did_gate: denying join to %s — no verified DID and room is DID-gated',
                room.jid);
            deny(origin, stanza, 'No verified identity for a DID-gated breakout room');
            return true; -- deny: no verified identity at all
        end

        local is_member = false;

        for _, member_did in ipairs(allowed_dids) do
            if member_did == did then
                is_member = true;
                break;
            end
        end

        if not is_member then
            module:log('warn', 'breakout_did_gate: denying join to %s for DID %s — not in room audience',
                room.jid, did);
            deny(origin, stanza, 'Not an assigned member of this breakout room');
            return true; -- deny: verified DID, but not an assigned member of this room
        end
    end

    -- .12: mark for moderator promotion on join, purely from the verified
    -- token claim — never from any client-controlled field.
    if is_verified_moderator then
        joining_moderator_participants[occupant.bare_jid] = true;
    end
end, 2); -- same priority as mod_muc_allowners.lua's equivalent hook

module:hook("muc-occupant-joined", function(event)
    local room, occupant = event.room, event.occupant;

    local promote = joining_moderator_participants[occupant.bare_jid];
    joining_moderator_participants[occupant.bare_jid] = nil; -- clear regardless

    if promote then
        room:set_affiliation(true, occupant.bare_jid, "owner");
    end
end, 2);

module:hook_global('config-reloaded', load_config);
