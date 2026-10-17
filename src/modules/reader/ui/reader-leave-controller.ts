export type ReaderLeaveGuard = (cancel: () => void) => void;

/** Resume the original removal only after the form has saved or discarded its draft. */
export function createReaderLeaveController() {
  let guard: ReaderLeaveGuard | null = null;
  let pending: (() => void) | null = null;
  let confirmed: (() => void) | null = null;
  let allowed = false;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach((listener) => listener());

  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => guard !== null && !allowed,
    register(next: ReaderLeaveGuard | null) {
      guard = next;
      notify();
    },
    request(action: () => void) {
      if (!guard || allowed) { action(); return; }
      if (pending) return;
      pending = action;
      guard(() => { if (pending === action) pending = null; });
    },
    confirm(fallback: () => void) {
      const action = pending ?? fallback;
      pending = null;
      if (!guard || allowed) { action(); return; }
      confirmed = action;
      allowed = true;
      notify();
    },
    // Called after usePreventRemove has observed the unblocked state.
    flush() {
      const action = confirmed;
      confirmed = null;
      action?.();
    },
    reset() {
      pending = null;
      confirmed = null;
      allowed = false;
      notify();
    },
  };
}
