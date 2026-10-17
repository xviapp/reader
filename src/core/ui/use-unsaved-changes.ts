import { useState } from 'react';
import { Alert } from 'react-native';

import { createCloseGuard } from './close-guard';

/** Protects an explicit save boundary from accidental back navigation. */
export function useUnsavedChanges(
  value: unknown,
  { busy, onClose, saveDraft }: { busy: boolean; onClose: () => void; saveDraft?: (() => Promise<boolean>) | undefined },
) {
  const serialized = JSON.stringify(value);
  const [saved, setSaved] = useState(serialized);
  const [guard] = useState(createCloseGuard);
  const dirty = saved !== serialized;
  const requestClose = (close = onClose) => guard.request({
    busy,
    dirty,
    close,
    saveDraft,
    confirm: ({ cancel, discard, save }) => Alert.alert(
      '有未保存的修改',
      save ? '可以保存当前草稿后退出，或放弃本次未保存的修改。' : '退出会放弃本次修改。',
      [
        { text: '继续编辑', style: 'cancel', onPress: cancel },
        { text: '放弃修改', style: 'destructive', onPress: discard },
        ...(save ? [{ text: '保存草稿并退出', onPress: () => { void save(); } }] : []),
      ],
      { cancelable: true, onDismiss: cancel },
    ),
  });
  return { dirty, requestClose, markSaved: () => setSaved(serialized) };
}
