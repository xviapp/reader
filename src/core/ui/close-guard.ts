export interface CloseRequest {
  busy: boolean;
  dirty: boolean;
  close: () => void;
  saveDraft?: (() => Promise<boolean>) | undefined;
  confirm: (actions: { cancel: () => void; discard: () => void; save?: (() => Promise<void>) | undefined }) => void;
}

// One confirmation/save at a time, even when back is pressed repeatedly.
export function createCloseGuard() {
  let active = false;
  return {
    request({ busy, dirty, close, saveDraft, confirm }: CloseRequest) {
      if (busy || active) return;
      if (!dirty) return close();
      active = true;
      let resolved = false;
      const finish = (discard: boolean) => {
        if (resolved) return;
        resolved = true;
        active = false;
        if (discard) close();
      };
      confirm({
        cancel: () => finish(false),
        discard: () => finish(true),
        save: saveDraft ? async () => {
          if (resolved) return;
          resolved = true;
          try {
            if (await saveDraft()) close();
          } finally {
            active = false;
          }
        } : undefined,
      });
    },
  };
}
