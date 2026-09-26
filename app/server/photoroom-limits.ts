// Photoroom documents 60 images/minute, including parallel calls. This is
// Studio's in-flight capacity, not a separately published provider concurrency cap.
export const PHOTOROOM_PARALLEL_REQUESTS = 60;

/** A shared rolling window across single-image and batch requests in this server.
 * Waiting here delays an unsent request; it never aborts an active request. */
export class PhotoroomRateLimit {
  private starts: number[] = [];
  private admission: Promise<void> = Promise.resolve();
  private wakeups = new Set<() => void>();
  // Wake admission checks when a batch pauses; never touch active HTTP calls.
  wake() { for (const wake of this.wakeups) wake(); }
  acquire(check: () => void = () => {}, beforeStart: () => Promise<void> = async () => {}): Promise<void> {
    const next = this.admission.then(async () => {
      for (;;) {
        check();
        const now = Date.now();
        this.starts = this.starts.filter(start => now - start < 60_000);
        if (this.starts.length < 60) {
          await beforeStart();
          check();
          this.starts.push(Date.now());
          return;
        }
        await new Promise<void>(resolve => {
          const finish = () => { clearTimeout(timer); this.wakeups.delete(finish); resolve(); };
          const timer = setTimeout(finish, Math.max(1, 60_000 - (now - this.starts[0])));
          this.wakeups.add(finish);
        });
      }
    });
    this.admission = next.catch(() => undefined);
    return next;
  }
}
export const photoroomRateLimit = new PhotoroomRateLimit();
