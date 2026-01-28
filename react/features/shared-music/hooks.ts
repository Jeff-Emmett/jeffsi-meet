import { useSelector } from 'react-redux';

import { SharedMusicButton } from './components';
import { isSharedMusicEnabled } from './functions';

const sharedMusic = {
    key: 'sharedmusic',
    Content: SharedMusicButton,
    group: 3
};

/**
 * A hook that returns the shared music button if it is enabled and undefined otherwise.
 *
 * @returns {Object | undefined}
 */
export function useSharedMusicButton() {
    const sharedMusicEnabled = useSelector(isSharedMusicEnabled);

    if (sharedMusicEnabled) {
        return sharedMusic;
    }
}
