import ReducerRegistry from '../base/redux/ReducerRegistry';

import { SET_DOCUMENT_PIP_ACTIVE, SET_DOCUMENT_PIP_MINIMIZED, SET_PIP_ACTIVE } from './actionTypes';

/**
 * The default state for the pip feature.
 */
const DEFAULT_STATE = {
    isPiPActive: false,
    isDocumentPiPActive: false,
    isDocumentPiPMinimized: false
};

export interface IPipState {
    isDocumentPiPActive: boolean;
    isDocumentPiPMinimized: boolean;
    isPiPActive: boolean;
}

/**
 * Reduces the Redux actions of the pip feature.
 */
ReducerRegistry.register<IPipState>('features/pip', (state = DEFAULT_STATE, action): IPipState => {
    switch (action.type) {
    case SET_PIP_ACTIVE:
        return {
            ...state,
            isPiPActive: action.isPiPActive
        };

    case SET_DOCUMENT_PIP_ACTIVE:
        return {
            ...state,
            isDocumentPiPActive: action.isDocumentPiPActive,

            // Always reset the minimized state when entering/exiting.
            isDocumentPiPMinimized: false
        };

    case SET_DOCUMENT_PIP_MINIMIZED:
        return {
            ...state,
            isDocumentPiPMinimized: action.isDocumentPiPMinimized
        };

    default:
        return state;
    }
});
