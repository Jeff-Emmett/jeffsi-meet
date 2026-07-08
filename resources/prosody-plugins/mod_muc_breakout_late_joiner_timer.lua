-- TASK-470.7 AC3 — unicasts a breakout room's active timer to a late joiner.
--
-- `mod_breakout_fanout_inject.lua` (loaded on the `meet.jitsi` VirtualHost,
-- for its HTTP endpoint) remembers the current `{endTimestamp, durationMs}`
-- per room jid in a `module:shared` table whenever it injects a
-- `breakout-timer-update` payload. THIS module is loaded on the MUC
-- component hosts instead (`XMPP_MUC_MODULES`/`XMPP_BREAKOUT_MUC_MODULES`) —
-- `muc-occupant-joined` only ever fires on the host the joined room actually
-- lives on, never on `meet.jitsi` itself. A single module hooking that event
-- while loaded only on `meet.jitsi` would silently never run; this was found
-- empirically (a real hand-rolled client joined a live staging room after a
-- timer had been injected and received nothing, even though the injection
-- itself, and this exact muc-occupant-joined + occupant.jid addressing
-- pattern, were independently proven working by mod_muc_breakout_did_gate.lua's
-- moderator-promotion feature) — root-caused to `XMPP_MODULES` vs
-- `XMPP_MUC_MODULES` being different Prosody hosts, not another instance of
-- the .7 `room:each_occupant()` test-harness gap.
--
-- `current_timers` MUST use the identical `module:shared(...)` key as
-- `mod_breakout_fanout_inject.lua` — that's what makes the two module
-- instances (different hosts, same process) see one shared table.

local is_admin = module:require("util").is_admin;
local st = require "util.stanza";
local json = require "cjson.safe";

-- current_timers[room_jid] = { endTimestamp = <ms>, durationMs = <ms>, payload = <table> }.
-- "/*/" = Prosody's GLOBAL shared-table scope (cross-host) -- MUST match
-- mod_breakout_fanout_inject.lua's key exactly, including the prefix, or the
-- two module instances (different hosts) each get their own empty table.
local current_timers = module:shared("/*/breakout_fanout_inject/current_timers");

-- Unicasts the room's remembered timer (if still in the future) to one
-- newly-joined occupant. No-ops if there's no remembered timer, it already
-- expired, or the payload can't be re-encoded.
local function send_current_timer_to(room, occupant)
    local timer = current_timers[room.jid];
    if not timer then
        return;
    end
    if type(timer.endTimestamp) ~= "number" or timer.endTimestamp <= (os.time() * 1000) then
        current_timers[room.jid] = nil; -- expired; stop carrying it forward
        return;
    end

    local json_msg, encode_err = json.encode(timer.payload);
    if not json_msg then
        module:log("warn", "breakout-late-joiner-timer: re-encode failed for %s: %s",
            room.jid, tostring(encode_err));
        return;
    end

    local stanza = st.message({ from = module.host, to = occupant.jid })
        :tag('json-message', { xmlns = 'http://jitsi.org/jitmeet' })
        :text(json_msg)
        :up();
    module:send(stanza);
end

module:hook("muc-occupant-joined", function(event)
    if is_admin(event.occupant.bare_jid) then
        return; -- server-internal (e.g. jicofo/jibri) — never targeted
    end
    send_current_timer_to(event.room, event.occupant);
end, 2);
