/** A bounded throttle: a continuous stream of commits cannot postpone notification. */
export class LanSyncCoordinator {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  changeSeq = 0;

  constructor(private readonly broadcast: (changeSeq: number) => void) {}

  invalidate = (): void => {
    if (this.stopped || this.timer !== null) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (!this.stopped) {
        this.changeSeq += 1;
        this.broadcast(this.changeSeq);
      }
    }, 100);
  };

  stop(): void {
    this.stopped = true;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
