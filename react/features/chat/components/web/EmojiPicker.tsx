import React, { useCallback, useEffect, useState } from 'react';
import { makeStyles } from 'tss-react/mui';

const useStyles = makeStyles()(() => {
    return {
        loading: {
            alignItems: 'center',
            display: 'flex',
            height: '435px',
            justifyContent: 'center'
        }
    };
});

interface IProps {
    onEmojiSelect: (emoji: string) => void;
}

const EmojiPicker: React.FC<IProps> = ({ onEmojiSelect }) => {
    const { classes } = useStyles();
    const [ PickerComponent, setPickerComponent ] = useState<React.ComponentType<any> | null>(null);
    const [ data, setData ] = useState<object | null>(null);

    useEffect(() => {
        Promise.all([
            import('@emoji-mart/react'),
            import('@emoji-mart/data')
        ]).then(([ pickerMod, dataMod ]) => {
            setPickerComponent(() => pickerMod.default);
            setData(dataMod.default);
        });
    }, []);

    const handleSelect = useCallback((emoji: { native: string; }) => {
        onEmojiSelect(emoji.native);
    }, [ onEmojiSelect ]);

    if (!PickerComponent || !data) {
        return (
            <div className = { classes.loading }>
                Loading...
            </div>
        );
    }

    return (
        <PickerComponent
            data = { data }
            onEmojiSelect = { handleSelect }
            previewPosition = 'none'
            skinTonePosition = 'search'
            theme = 'dark' />
    );
};

export default EmojiPicker;
