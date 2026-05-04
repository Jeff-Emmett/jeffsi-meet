/**
 * The type of (redux) action to reset the breakout rooms data.
 */
export const _RESET_BREAKOUT_ROOMS = '_RESET_BREAKOUT_ROOMS';

/**
 * The type of (redux) action to update the room counter locally.
 */
export const _UPDATE_ROOM_COUNTER = '_UPDATE_ROOM_COUNTER';

/**
  * The type of (redux) action to update the breakout room data.
  *
  */
export const UPDATE_BREAKOUT_ROOMS = 'UPDATE_BREAKOUT_ROOMS';

/**
 * Action to update the breakout-room timer state ({ endTimestamp, durationMs }).
 * `endTimestamp = null` clears the timer.
 */
export const UPDATE_BREAKOUT_TIMER = 'UPDATE_BREAKOUT_TIMER';
