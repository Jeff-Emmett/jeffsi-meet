/**
 * LocalStorage-based token storage for Meeting Intelligence access control.
 *
 * Tokens are keyed by conference_id (room name) so attendees can access
 * meeting data across sessions without user accounts.
 */

const STORAGE_KEY = 'mi-tokens';

/**
 * Get all stored tokens as a map of conferenceId -> token.
 *
 * @returns {Record<string, string>} The stored tokens.
 */
export function getStoredTokens(): Record<string, string> {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);

        if (!raw) {
            return {};
        }

        return JSON.parse(raw);
    } catch {
        return {};
    }
}

/**
 * Store a token for a conference.
 *
 * @param {string} conferenceId - The conference/room name.
 * @param {string} token - The access token.
 * @returns {void}
 */
export function storeToken(conferenceId: string, token: string): void {
    try {
        const tokens = getStoredTokens();

        tokens[conferenceId] = token;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(tokens));
    } catch {
        // localStorage may be unavailable
    }
}

/**
 * Get a flat array of all stored token values.
 *
 * @returns {string[]} Array of token strings.
 */
export function getAllTokens(): string[] {
    return Object.values(getStoredTokens());
}

/**
 * Get the token for a specific conference.
 *
 * @param {string} conferenceId - The conference/room name.
 * @returns {string|undefined} The token or undefined.
 */
export function getTokenForConference(conferenceId: string): string | undefined {
    return getStoredTokens()[conferenceId];
}
