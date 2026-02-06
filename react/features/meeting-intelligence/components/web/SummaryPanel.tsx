import React, { useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';

import { IReduxState } from '../../../app/types';
import { exportMeeting, generateSummary } from '../../actions';
import { getMeetingIntelligenceState } from '../../functions';

/**
 * AI-generated meeting summary panel.
 *
 * @returns {React.ReactElement} The summary panel component.
 */
const SummaryPanel: React.FC = () => {
    const dispatch = useDispatch();
    const {
        summary,
        summaryLoading,
        summaryError,
        selectedMeetingId,
        selectedMeeting,
        exportLoading
    } = useSelector((state: IReduxState) => getMeetingIntelligenceState(state));

    const handleGenerateSummary = useCallback(() => {
        if (selectedMeetingId) {
            dispatch(generateSummary(selectedMeetingId) as any);
        }
    }, [ dispatch, selectedMeetingId ]);

    const handleExportMarkdown = useCallback(() => {
        if (selectedMeetingId) {
            dispatch(exportMeeting(selectedMeetingId, 'markdown') as any);
        }
    }, [ dispatch, selectedMeetingId ]);

    const handleExportPdf = useCallback(() => {
        if (selectedMeetingId) {
            dispatch(exportMeeting(selectedMeetingId, 'pdf') as any);
        }
    }, [ dispatch, selectedMeetingId ]);

    const handleExportJson = useCallback(() => {
        if (selectedMeetingId) {
            dispatch(exportMeeting(selectedMeetingId, 'json') as any);
        }
    }, [ dispatch, selectedMeetingId ]);

    if (summaryLoading) {
        return (
            <div className = 'summary-loading'>
                <div className = 'spinner' />
                <span>Loading summary...</span>
            </div>
        );
    }

    if (summaryError) {
        return (
            <div className = 'summary-error'>
                <p>Failed to load summary: {summaryError}</p>
                <button
                    className = 'btn-primary'
                    onClick = { handleGenerateSummary }
                    type = 'button'>
                    Try Again
                </button>
            </div>
        );
    }

    if (!summary) {
        const canGenerate = selectedMeeting?.status === 'ready';

        return (
            <div className = 'summary-empty'>
                <svg
                    fill = 'currentColor'
                    height = '48'
                    viewBox = '0 0 24 24'
                    width = '48'>
                    <path d = 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14z' />
                    <path d = 'M18 9l-1.41-1.42L10 14.17l-2.59-2.58L6 13l4 4z' />
                </svg>
                <h3>No summary yet</h3>
                <p>
                    {canGenerate
                        ? 'Generate an AI summary to see key points, action items, and decisions.'
                        : 'Summary will be available after transcription is complete.'}
                </p>
                {canGenerate && (
                    <button
                        className = 'btn-primary'
                        onClick = { handleGenerateSummary }
                        type = 'button'>
                        Generate Summary
                    </button>
                )}
            </div>
        );
    }

    return (
        <div className = 'summary-panel'>
            <div className = 'summary-section'>
                <h3>Summary</h3>
                <p className = 'summary-text'>{summary.summary_text}</p>
            </div>

            {summary.key_points && summary.key_points.length > 0 && (
                <div className = 'summary-section'>
                    <h3>Key Points</h3>
                    <ul className = 'key-points-list'>
                        {summary.key_points.map((point, index) => (
                            <li key = { index }>{point}</li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.action_items && summary.action_items.length > 0 && (
                <div className = 'summary-section'>
                    <h3>Action Items</h3>
                    <ul className = 'action-items-list'>
                        {summary.action_items.map((item, index) => (
                            <li key = { index }>
                                <span className = 'action-checkbox'>☐</span>
                                <span className = 'action-task'>{item.task}</span>
                                {item.assignee && (
                                    <span className = 'action-assignee'>
                                        ({item.assignee})
                                    </span>
                                )}
                            </li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.decisions && summary.decisions.length > 0 && (
                <div className = 'summary-section'>
                    <h3>Decisions</h3>
                    <ul className = 'decisions-list'>
                        {summary.decisions.map((decision, index) => (
                            <li key = { index }>{decision}</li>
                        ))}
                    </ul>
                </div>
            )}

            {summary.topics && summary.topics.length > 0 && (
                <div className = 'summary-section'>
                    <h3>Topics Discussed</h3>
                    <div className = 'topics-tags'>
                        {summary.topics.map((topic, index) => (
                            <span
                                className = 'topic-tag'
                                key = { index }>
                                {topic}
                            </span>
                        ))}
                    </div>
                </div>
            )}

            <div className = 'summary-export'>
                <h3>Export</h3>
                <div className = 'export-buttons'>
                    <button
                        className = 'btn-secondary'
                        disabled = { exportLoading }
                        onClick = { handleExportMarkdown }
                        type = 'button'>
                        Markdown
                    </button>
                    <button
                        className = 'btn-secondary'
                        disabled = { exportLoading }
                        onClick = { handleExportPdf }
                        type = 'button'>
                        PDF
                    </button>
                    <button
                        className = 'btn-secondary'
                        disabled = { exportLoading }
                        onClick = { handleExportJson }
                        type = 'button'>
                        JSON
                    </button>
                </div>
            </div>
        </div>
    );
};

export default SummaryPanel;
