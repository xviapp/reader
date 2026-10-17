import { Alert } from 'react-native';
import { useCallback } from 'react';

import { useReaderNavigationGuard } from './use-reader-navigation';

interface ReaderDraftGuardOptions {
  dirty: boolean;
  pending?: boolean;
  onBack: () => void;
  onSave?: () => void | Promise<void>;
  saveLabel?: string;
  noun?: string;
}

/** Protects drafts during hardware back, gestures, sidebar changes and in-app back. */
export function useReaderDraftGuard({ dirty, pending = false, onBack, onSave, saveLabel = '保存并返回', noun = '内容' }: ReaderDraftGuardOptions): () => void {
  const requestBack = useCallback((cancel: () => void = () => undefined) => {
    if (pending) { cancel(); return; }
    if (!dirty) {
      onBack();
      return;
    }
    const actions: { text: string; style?: 'cancel' | 'destructive'; onPress?: () => void }[] = [
      { text: '继续编辑', style: 'cancel', onPress: cancel },
      { text: '放弃修改', style: 'destructive', onPress: onBack },
    ];
    if (onSave) actions.push({ text: saveLabel, onPress: () => { void Promise.resolve(onSave()).finally(cancel); } });
    Alert.alert(
      '有未保存修改',
      onSave ? `要保存${noun}后离开吗？` : `要放弃${noun}吗？`,
      actions,
      { cancelable: true, onDismiss: cancel },
    );
  }, [dirty, noun, onBack, onSave, pending, saveLabel]);
  useReaderNavigationGuard(requestBack);
  return useCallback(() => requestBack(), [requestBack]);
}
