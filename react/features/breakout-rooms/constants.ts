/**
 * Key for this feature.
 */
export const FEATURE_KEY = 'features/breakout-rooms';

/**
 * Feature to rename breakout rooms.
 */
export const BREAKOUT_ROOMS_RENAME_FEATURE = 'rename';

/**
 * JSON `type` field used for cross-room signalling (moderator broadcasts,
 * help requests, timer updates). Value is observed via the existing
 * `ENDPOINT_MESSAGE_RECEIVED` (within-room JSON channel) — true cross-room
 * delivery requires the embedder to fan out using the iframe API events.
 */
export const BREAKOUT_BROADCAST_TYPE = 'breakout-broadcast';
export const BREAKOUT_HELP_REQUEST_TYPE = 'breakout-help-request';
export const BREAKOUT_TIMER_UPDATE_TYPE = 'breakout-timer-update';

/**
 * Notification when the in-breakout countdown is about to expire.
 */
export const BREAKOUT_TIMER_WARNING_MS = 60_000;
