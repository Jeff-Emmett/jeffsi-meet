import React, { useCallback, useState } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { searchTranscripts, selectMeeting } from '../../actions';
import { formatDate, formatTime, getMeetingIntelligenceState } from '../../functions';

/**
 * Search panel for searching across all meeting transcripts.
 *
 * @returns {React.ReactElement} The search panel component.
 */
const SearchPanel: React.FC = () => {
    const dispatch = useDispatch();
    const { searchQuery, searchResults, searchLoading, searchError } = useSelector(
        (state: IReduxState) => getMeetingIntelligenceState(state)
    );
    const [ inputValue, setInputValue ] = useState(searchQuery);

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        setInputValue(e.target.value);
    }, []);

    const handleSubmit = useCallback((e: React.FormEvent) => {
        e.preventDefault();
        dispatch(searchTranscripts(inputValue) as any);
    }, [ dispatch, inputValue ]);

    const handleResultClick = useCallback((e: React.MouseEvent<HTMLDivElement> | React.KeyboardEvent<HTMLDivElement>) => {
        const meetingId = e.currentTarget.dataset.meetingId;

        if (meetingId) {
            dispatch(selectMeeting(meetingId) as any);
        }
    }, [ dispatch ]);

    return (
        <div className = 'search-panel'>
            <form
                className = 'search-form'
                onSubmit = { handleSubmit }>
                <input
                    className = 'search-input'
                    onChange = { handleInputChange }
                    placeholder = 'Search transcripts...'
                    type = 'text'
                    value = { inputValue } />
                <button
                    className = 'search-button'
                    disabled = { searchLoading }
                    type = 'submit'>
                    {searchLoading ? (
                        <div className = 'spinner-small' />
                    ) : (
                        <svg
                            fill = 'currentColor'
                            height = '20'
                            viewBox = '0 0 24 24'
                            width = '20'>
                            <path d = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' />
                        </svg>
                    )}
                </button>
            </form>

            {searchError && (
                <div className = 'search-error'>
                    <p>Search failed: {searchError}</p>
                </div>
            )}

            {searchResults.length > 0 && (
                <div className = 'search-results'>
                    <div className = 'search-results-header'>
                        {searchResults.length} result{searchResults.length !== 1 ? 's' : ''} found
                    </div>
                    {searchResults.map((result, index) => (
                        <div
                            className = 'search-result-item'
                            data-meeting-id = { result.meeting_id }
                            key = { index }
                            onClick = { handleResultClick }
                            onKeyDown = { handleResultClick }
                            role = 'button'
                            tabIndex = { 0 }>
                            <div className = 'search-result-header'>
                                <span className = 'search-result-title'>
                                    {result.title || result.conference_id}
                                </span>
                                {result.started_at && (
                                    <span className = 'search-result-date'>
                                        {formatDate(result.started_at)}
                                    </span>
                                )}
                            </div>
                            <div className = 'search-result-snippet'>
                                {result.speaker_label && (
                                    <span className = 'search-result-speaker'>
                                        {result.speaker_label}:
                                    </span>
                                )}
                                <span className = 'search-result-text'>
                                    {result.segment_text}
                                </span>
                            </div>
                            <div className = 'search-result-meta'>
                                <span className = 'search-result-time'>
                                    at {formatTime(result.start_time)}
                                </span>
                                <span className = 'search-result-score'>
                                    Relevance: {Math.round(result.score * 100)}%
                                </span>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {searchQuery && searchResults.length === 0 && !searchLoading && !searchError && (
                <div className = 'search-no-results'>
                    <svg
                        fill = 'currentColor'
                        height = '48'
                        viewBox = '0 0 24 24'
                        width = '48'>
                        <path d = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' />
                    </svg>
                    <h3>No results found</h3>
                    <p>Try different keywords or check the spelling.</p>
                </div>
            )}

            {!searchQuery && (
                <div className = 'search-hint'>
                    <svg
                        fill = 'currentColor'
                        height = '48'
                        viewBox = '0 0 24 24'
                        width = '48'>
                        <path d = 'M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z' />
                    </svg>
                    <h3>Search across all meetings</h3>
                    <p>Find specific topics, decisions, or action items mentioned in any meeting.</p>
                </div>
            )}
        </div>
    );
};

export default SearchPanel;
