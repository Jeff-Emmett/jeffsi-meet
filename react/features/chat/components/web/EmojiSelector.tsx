import { Theme } from '@mui/material';
import React, { useCallback } from 'react';
import { makeStyles } from 'tss-react/mui';

interface IProps {
    onExpand?: () => void;
    onSelect: (emoji: string) => void;
}

const useStyles = makeStyles()((theme: Theme) => {
    return {
        emojiGrid: {
            display: 'flex',
            flexDirection: 'row',
            borderRadius: '4px',
            backgroundColor: theme.palette.ui03
        },

        emojiButton: {
            cursor: 'pointer',
            padding: '5px',
            fontSize: '1.5em'
        },

        expandButton: {
            cursor: 'pointer',
            padding: '5px',
            fontSize: '1.2em',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            opacity: 0.7,

            '&:hover': {
                opacity: 1
            }
        }
    };
});

const EmojiSelector: React.FC<IProps> = ({ onSelect, onExpand }) => {
    const { classes } = useStyles();

    const emojiMap: Record<string, string> = {
        thumbsUp: '👍',
        redHeart: '❤️',
        faceWithTearsOfJoy: '😂',
        faceWithOpenMouth: '😮',
        fire: '🔥',
        clap: '👏',
        party: '🎉',
        thinking: '🤔'
    };
    const emojiNames = Object.keys(emojiMap);

    const handleSelect = useCallback(
        (emoji: string) => (event: React.MouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            onSelect(emoji);
        },
        [ onSelect ]
    );

    const handleExpand = useCallback(
        (event: React.MouseEvent<HTMLSpanElement>) => {
            event.preventDefault();
            onExpand?.();
        },
        [ onExpand ]
    );

    return (
        <div className = { classes.emojiGrid }>
            {emojiNames.map(name => (
                <span
                    className = { classes.emojiButton }
                    key = { name }
                    onClick = { handleSelect(emojiMap[name]) }>
                    {emojiMap[name]}
                </span>
            ))}
            {onExpand && (
                <span
                    className = { classes.expandButton }
                    onClick = { handleExpand }>
                    +
                </span>
            )}
        </div>
    );
};

export default EmojiSelector;
