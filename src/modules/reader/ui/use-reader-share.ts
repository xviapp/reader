import { useRef, useState } from 'react';

export function useReaderShare(onError: (message: string | null) => void) {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const run = (share: () => Promise<void>) => {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    onError(null);
    void Promise.resolve().then(share).catch((cause: unknown) => {
      onError(cause instanceof Error ? cause.message : '分享失败，请重试');
    }).finally(() => { busy.current = false; setPending(false); });
  };
  return { run, pending };
}
