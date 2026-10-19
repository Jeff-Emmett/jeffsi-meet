import { IStore } from '../../../app/types';

interface ILocalRecordingManager {
    isRecordingLocally: () => boolean;
    isSupported: () => boolean;
    onTranscriptionResult: (json: any) => void;
    selfRecording: {
        on: boolean;
        withVideo: boolean;
    };
    startLocalRecording: (store: IStore, onlySelf: boolean) => Promise<void>;
    stopLocalRecording: () => void;
    syncSources: () => void;
}

const LocalRecordingManager: ILocalRecordingManager = {
    selfRecording: {
        on: false,
        withVideo: false
    },

    /**
     * Records a transcription result.
     *
     * @returns {void}
     */
    onTranscriptionResult() { }, // eslint-disable-line @typescript-eslint/no-empty-function

    /**
     * Re-syncs the recorded sources.
     *
     * @returns {void}
     */
    syncSources() { }, // eslint-disable-line @typescript-eslint/no-empty-function

    /**
     * Stops local recording.
     *
     * @returns {void}
     * */
    stopLocalRecording() { }, // eslint-disable-line @typescript-eslint/no-empty-function

    /**
     * Starts a local recording.
     *
     * @param {IStore} store - The Redux store.
     * @returns {void}
     */
    async startLocalRecording() { }, // eslint-disable-line @typescript-eslint/no-empty-function

    /**
     * Whether or not local recording is supported.
     *
     * @returns {boolean}
     */
    isSupported() {
        return false;
    },

    /**
     * Whether or not we're currently recording locally.
     *
     * @returns {boolean}
     */
    isRecordingLocally() {
        return false;
    }

};

export default LocalRecordingManager;
