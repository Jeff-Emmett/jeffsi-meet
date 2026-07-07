import React from 'react';

import { IProps as AbstractButtonProps } from '../../../base/toolbox/components/AbstractButton';
import HangupButton from '../HangupButton';

const HangupContainerButtons = (props: AbstractButtonProps) => {
    // "End meeting for all" disabled in this fork — always render plain leave button.
    return <HangupButton { ...props } />;
};

export default HangupContainerButtons;
