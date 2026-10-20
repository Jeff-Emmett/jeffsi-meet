import createCache, { EmotionCache } from '@emotion/cache';
import { CacheProvider } from '@emotion/react';
import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom';
import { useDispatch } from 'react-redux';

import { IStore } from '../../app/types';
import { exitDocumentPiP } from '../actions';
import { getDocumentPiPWindow } from '../functions';

import DocumentPiPContent from './DocumentPiPContent';

/**
 * Portals {@link DocumentPiPContent} into the Document Picture-in-Picture window.
 *
 * The body's styles are written into the popout's own document through a
 * dedicated emotion cache. The app's stylesheets are copied in once when the
 * window opens, but these components inject their rules when they first render,
 * which is after that copy, into the main document, where the popout can't see
 * them. That left the popout unstyled: every control stacked on its own row and
 * the toolbar ran off the bottom of the window.
 *
 * @returns {React.ReactPortal | null}
 */
const DocumentPiPPortal: React.FC = () => {
    const dispatch: IStore['dispatch'] = useDispatch();
    const [ target, setTarget ] = useState<{ cache: EmotionCache; container: HTMLElement; } | null>(null);

    /**
     * Grabs the open Document PiP window's body as the portal target, and
     * makes sure closing the popout (native 'X', OS close, etc.) syncs
     * Redux state back.
     */
    useEffect(() => {
        const pipWindow = getDocumentPiPWindow();

        if (!pipWindow) {
            return;
        }

        const { body, head } = pipWindow.document;

        body.style.margin = '0';
        body.style.overflow = 'hidden';
        setTarget({
            cache: createCache({ key: 'pip', container: head }),
            container: body
        });

        const onPageHide = () => dispatch(exitDocumentPiP());

        pipWindow.addEventListener('pagehide', onPageHide);

        return () => pipWindow.removeEventListener('pagehide', onPageHide);
    }, [ dispatch ]);

    if (!target) {
        return null;
    }

    return ReactDOM.createPortal(
        <CacheProvider value = { target.cache }>
            <DocumentPiPContent />
        </CacheProvider>,
        target.container
    );
};

export default DocumentPiPPortal;
