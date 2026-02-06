import { useSelector } from 'react-redux';

import MeetingIntelligenceButton from './components/web/MeetingIntelligenceButton';
import { isMeetingIntelligenceEnabled } from './functions';

const meetingIntelligence = {
    key: 'meetingintelligence',
    Content: MeetingIntelligenceButton,
    group: 3
};

/**
 * A hook that returns the meeting intelligence button if it is enabled and undefined otherwise.
 *
 * @returns {Object | undefined}
 */
export function useMeetingIntelligenceButton() {
    const meetingIntelligenceEnabled = useSelector(isMeetingIntelligenceEnabled);

    if (meetingIntelligenceEnabled) {
        return meetingIntelligence;
    }
}
