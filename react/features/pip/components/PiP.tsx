import React from 'react';
import { useSelector } from 'react-redux';

import { IReduxState } from '../../app/types';
import { shouldShowPiP } from '../functions';

import DocumentPiPPortal from './DocumentPiPPortal';
import PiPVideoElement from './PiPVideoElement';

/**
 * Wrapper component that conditionally renders PiPVideoElement and,
 * when a Document PiP window is open, the portaled DocumentPiPPortal.
 * Prevents mounting when PiP is disabled or on prejoin without showOnPrejoin flag.
 *
 * @returns {React.ReactElement | null}
 */
function PiP() {
    const showPiP = useSelector(shouldShowPiP);
    const isDocumentPiPActive = useSelector((state: IReduxState) => state['features/pip']?.isDocumentPiPActive);

    if (!showPiP) {
        return null;
    }

    return (
        <>
            <PiPVideoElement />
            {isDocumentPiPActive && <DocumentPiPPortal />}
        </>
    );
}

export default PiP;
