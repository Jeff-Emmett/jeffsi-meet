/**
 * Shared utilities for PiP feature used by external_api.js.
 *
 * IMPORTANT: Keep this file minimal with no heavy dependencies.
 * It's bundled into external_api.min.js and we want to keep that bundle slim.
 * Only import lightweight modules here.
 */

/**
 * Checks if current environment is Electron.
 * Inline check to avoid importing BrowserDetection and its ua-parser dependency.
 *
 * @returns {boolean} - True if running in Electron.
 */
function isElectron(): boolean {
    return navigator.userAgent.includes('Electron');
}

/**
 * Checks if the Document Picture-in-Picture API is supported.
 * Inline check with no imports to keep external_api.min.js slim.
 *
 * @returns {boolean} - True if the browser supports Document PiP.
 */
function isDocumentPiPSupported(): boolean {
    return 'documentPictureInPicture' in window;
}

/**
 * Checks if classic (video-element) Picture-in-Picture is supported.
 * Inline check with no imports to keep external_api.min.js slim.
 *
 * @returns {boolean} - True if the browser supports video-element PiP.
 */
function isVideoPiPSupported(): boolean {
    return 'pictureInPictureEnabled' in document && Boolean((document as any).pictureInPictureEnabled);
}

/**
 * Checks if PiP is enabled based on config and environment.
 *
 * @param {Object} pipConfig - The pip config object.
 * @returns {boolean} - True if PiP is enabled.
 */
export function isPiPEnabled(pipConfig?: { disabled?: boolean; }): boolean {
    if (pipConfig?.disabled) {
        return false;
    }

    return isElectron() || isDocumentPiPSupported() || isVideoPiPSupported();
}
