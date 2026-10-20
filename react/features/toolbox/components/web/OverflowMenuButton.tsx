import React, { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { useDispatch, useSelector } from 'react-redux';
import { makeStyles } from 'tss-react/mui';

import { createToolbarEvent } from '../../../analytics/AnalyticsEvents';
import { sendAnalytics } from '../../../analytics/functions';
import Popover from '../../../base/popover/components/Popover.web';
import ContextMenu from '../../../base/ui/components/web/ContextMenu';
import ContextMenuItemGroup from '../../../base/ui/components/web/ContextMenuItemGroup';
import { setGifMenuVisibility } from '../../../gifs/actions';
import { isGifsMenuOpen } from '../../../gifs/functions.web';
import ReactionEmoji from '../../../reactions/components/web/ReactionEmoji';
import ReactionsMenu from '../../../reactions/components/web/ReactionsMenu';
import { getReactionsQueue } from '../../../reactions/functions.any';
import { IReactionsMenuParent } from '../../../reactions/types';
import { DRAWER_MAX_HEIGHT } from '../../constants';
import { showOverflowDrawer } from '../../functions.web';

import Drawer from './Drawer';
import JitsiPortal from './JitsiPortal';
import OverflowToggleButton from './OverflowToggleButton';

/**
 * The type of the React {@code Component} props of {@link OverflowMenuButton}.
 */
interface IProps {

    /**
     * ID of the menu that is controlled by this button.
     */
    ariaControls: string;

    /**
     * Information about the buttons that need to be rendered in the overflow menu.
     */
    buttons: Object[];

    /**
     * Whether or not the OverflowMenu popover should display.
     */
    isOpen: boolean;

    /**
     * Esc key handler.
     */
    onToolboxEscKey: (e?: React.KeyboardEvent) => void;

    /**
     * Callback to change the visibility of the overflow menu.
     */
    onVisibilityChange: Function;

    /**
     * Whether to show the raise hand in the reactions menu or not.
     */
    showRaiseHandInReactionsMenu: boolean;

    /**
     * Whether or not to display the reactions menu.
     */
    showReactionsMenu: boolean;
}

// The menu is a flex column: the button list scrolls in whatever height is
// left and the reactions tray keeps its natural height below it. Sizing the
// list by subtracting a hardcoded tray height broke whenever the tray wrapped
// to more rows than assumed (narrow phones, landscape), and the tray then
// covered the last menu items.
const useStyles = makeStyles<{ overflowDrawer: boolean; }>()(
(_theme, { overflowDrawer }) => {
    return {
        overflowMenuDrawer: {
            display: 'flex',
            flexDirection: 'column' as const,
            maxHeight: `calc(${DRAWER_MAX_HEIGHT})`,

            // ContextMenu's drawer wrapper, which has no class hook of its own.
            '& > div': {
                display: 'flex',
                flexDirection: 'column' as const,
                flex: '1 1 auto',
                minHeight: 0
            }
        },
        contextMenu: {
            position: 'relative' as const,
            right: 'auto',
            margin: 0,
            marginBottom: '8px',
            maxHeight: overflowDrawer ? undefined : 'calc(100dvh - 100px)',
            paddingBottom: overflowDrawer ? undefined : 0,
            minWidth: '240px',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column' as const
        },
        content: {
            position: 'relative',
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto'
        },
        footer: {
            flexShrink: 0
        }
    };
});

const OverflowMenuButton = ({
    buttons,
    isOpen,
    onToolboxEscKey,
    onVisibilityChange,
    showRaiseHandInReactionsMenu,
    showReactionsMenu
}: IProps) => {
    const overflowDrawer = useSelector(showOverflowDrawer);
    const reactionsQueue = useSelector(getReactionsQueue);
    const isGiphyVisible = useSelector(isGifsMenuOpen);
    const dispatch = useDispatch();

    const onCloseDialog = useCallback(() => {
        onVisibilityChange(false);
        if (isGiphyVisible && !overflowDrawer) {
            dispatch(setGifMenuVisibility(false));
        }
    }, [ onVisibilityChange, setGifMenuVisibility, isGiphyVisible, overflowDrawer, dispatch ]);

    const onOpenDialog = useCallback(() => {
        onVisibilityChange(true);
    }, [ onVisibilityChange ]);

    const onEscClick = useCallback((event: React.KeyboardEvent) => {
        if (event.key === 'Escape' && isOpen) {
            event.preventDefault();
            event.stopPropagation();
            onCloseDialog();
        }
    }, [ onCloseDialog ]);

    const toggleDialogVisibility = useCallback(() => {
        sendAnalytics(createToolbarEvent('overflow'));

        onVisibilityChange(!isOpen);
    }, [ isOpen, onVisibilityChange ]);

    const toolbarAccLabel = 'toolbar.accessibilityLabel.moreActionsMenu';
    const { t } = useTranslation();
    const { classes } = useStyles({ overflowDrawer });

    const groupsJSX = buttons.map((buttonGroup: any) => (
        <ContextMenuItemGroup key = { `group-${buttonGroup[0].group}` }>
            {buttonGroup.map(({ key, Content, ...rest }: { Content: React.ElementType; key: string; }) => {
                const props: { buttonKey?: string; contextMenu?: boolean; showLabel?: boolean; } = { ...rest };

                if (key !== 'reactions') {
                    props.buttonKey = key;
                    props.contextMenu = true;
                    props.showLabel = true;
                }

                return (
                    <Content
                        { ...props }
                        key = { key } />);
            })}
        </ContextMenuItemGroup>));

    const overflowMenu = groupsJSX && (
        <ContextMenu
            accessibilityLabel = { t(toolbarAccLabel) }
            className = { classes.contextMenu }
            hidden = { false }
            id = 'overflow-context-menu'
            inDrawer = { overflowDrawer }
            onKeyDown = { onToolboxEscKey }>
            <div className = { classes.content }>
                { groupsJSX }
            </div>
            {
                showReactionsMenu && (<div className = { classes.footer }>
                    <ReactionsMenu
                        parent = {
                            overflowDrawer ? IReactionsMenuParent.OverflowDrawer : IReactionsMenuParent.OverflowMenu }
                        showRaisedHand = { showRaiseHandInReactionsMenu } />
                </div>)
            }
        </ContextMenu>);

    if (overflowDrawer) {
        return (
            <div className = 'toolbox-button-wth-dialog context-menu'>
                <>
                    <OverflowToggleButton
                        handleClick = { toggleDialogVisibility }
                        isOpen = { isOpen }
                        onKeyDown = { onEscClick } />
                    <JitsiPortal>
                        <Drawer
                            isOpen = { isOpen }
                            onClose = { onCloseDialog }>
                            <>
                                <div className = { classes.overflowMenuDrawer }>
                                    { overflowMenu }
                                </div>
                            </>
                        </Drawer>
                        {showReactionsMenu && <div className = 'reactions-animations-overflow-container'>
                            {reactionsQueue.map(({ reaction, uid }, index) => (<ReactionEmoji
                                index = { index }
                                key = { uid }
                                reaction = { reaction }
                                uid = { uid } />))}
                        </div>}
                    </JitsiPortal>
                </>
            </div>
        );
    }

    return (
        <div className = 'toolbox-button-wth-dialog context-menu'>
            <Popover
                content = { overflowMenu }
                headingId = 'overflow-context-menu'
                onPopoverClose = { onCloseDialog }
                onPopoverOpen = { onOpenDialog }
                position = 'top'
                trigger = 'click'
                visible = { isOpen }>
                <OverflowToggleButton
                    isMenuButton = { true }
                    isOpen = { isOpen }
                    onKeyDown = { onEscClick } />
            </Popover>
            {showReactionsMenu && <div className = 'reactions-animations-container'>
                {reactionsQueue.map(({ reaction, uid }, index) => (<ReactionEmoji
                    index = { index }
                    key = { uid }
                    reaction = { reaction }
                    uid = { uid } />))}
            </div>}
        </div>
    );
};

export default OverflowMenuButton;
