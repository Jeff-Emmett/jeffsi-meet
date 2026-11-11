import { IStore } from '../app/types';
import { pinParticipant } from '../base/participants/actions';
import { setFilmstripVisible } from '../filmstrip/actions.any';

/**
 * Gallery "focus": clicking a tile in tile view fills the stage with that
 * participant (pin + hide the filmstrip); clicking the stage again or pressing
 * Escape returns to the gallery. Leaving the pin restores tile view through
 * the existing PIN_PARTICIPANT handling in middleware.any.ts.
 *
 * Kept outside redux on purpose: nothing renders from it, it only remembers
 * the filmstrip visibility to put back on exit.
 */
let focus: { filmstripWasVisible: boolean; participantId: string; } | undefined;

/**
 * Whether a gallery focus is active.
 *
 * @returns {boolean}
 */
export function isTileFocusActive() {
    return Boolean(focus);
}

/**
 * The focused participant, if any.
 *
 * @returns {string | undefined}
 */
export function getTileFocusParticipantId() {
    return focus?.participantId;
}

/**
 * Drops the focus without dispatching (the conference is going away, and the
 * next one starts with the filmstrip state redux already holds).
 *
 * @returns {void}
 */
export function resetTileFocus() {
    focus = undefined;
}

/**
 * Focuses a participant from the gallery.
 *
 * @param {string} participantId - The participant whose tile was clicked.
 * @returns {Function}
 */
export function enterTileFocus(participantId: string) {
    return (dispatch: IStore['dispatch'], getState: IStore['getState']) => {
        focus = {
            filmstripWasVisible: getState()['features/filmstrip'].visible,
            participantId
        };
        dispatch(pinParticipant(participantId));
        dispatch(setFilmstripVisible(false));
    };
}

/**
 * Leaves the gallery focus, if one is active.
 *
 * @returns {Function}
 */
export function exitTileFocus() {
    return (dispatch: IStore['dispatch']) => {
        focus && dispatch(pinParticipant(null));
    };
}

/**
 * Called on every PIN_PARTICIPANT: any pin change away from the focused
 * participant (unpin, menu pin of someone else, tile view toggled) ends the
 * focus and puts the filmstrip back.
 *
 * @param {IStore} store - The redux store.
 * @param {string | undefined} pinnedId - The newly pinned participant, if any.
 * @returns {void}
 */
export function onPinChanged({ dispatch }: IStore, pinnedId?: string) {
    if (!focus || pinnedId === focus.participantId) {
        return;
    }

    const { filmstripWasVisible } = focus;

    focus = undefined;
    dispatch(setFilmstripVisible(filmstripWasVisible));
}
