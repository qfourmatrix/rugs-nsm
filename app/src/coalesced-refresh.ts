/** Serialize reads, discard superseded snapshots, and drain one trailing refresh.
 * All callers wait for the final snapshot, including mutations during a read.
 * Failures settle normally; only another explicit request schedules a retry.
 */
export function createCoalescedRefresh<T>(read: () => Promise<T>, apply: (snapshot: T) => boolean) {
  let inFlight: Promise<boolean> | null = null;
  let requested = false;
  return (): Promise<boolean> => {
    requested = true;
    if (inFlight) return inFlight;
    inFlight = Promise.resolve().then(async () => {
      do {
        requested = false;
        const snapshot = await read();
        if (!requested) return apply(snapshot);
      } while (requested);
      return false;
    }).finally(() => { inFlight = null; });
    return inFlight;
  };
}
