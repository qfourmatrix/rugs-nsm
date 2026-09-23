import { AppError } from "./errors";

/** FIFO, bounded admission and guaranteed release on both sync and async failure. */
export class WorkScheduler {
  private activeCount = 0;
  private readonly waiting: Array<() => void> = [];
  constructor(private readonly concurrency: number, private readonly maximumWaiting: number) {
    if (!Number.isInteger(concurrency) || concurrency < 1 || !Number.isInteger(maximumWaiting) || maximumWaiting < 0) throw new Error("Invalid scheduler limits.");
  }
  get active() { return this.activeCount; }
  get queued() { return this.waiting.length; }

  run<T>(action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) return Promise.reject(signal.reason);
    if (this.activeCount >= this.concurrency && this.waiting.length >= this.maximumWaiting) {
      return Promise.reject(new AppError(429, "WORK_QUEUE_FULL", "Heavy-work queue is full. Wait for existing work to finish before trying again."));
    }
    return new Promise<T>((resolve, reject) => {
      const abort = () => {
        const index = this.waiting.indexOf(start);
        if (index >= 0) this.waiting.splice(index, 1);
        reject(signal?.reason);
      };
      const start = () => {
        signal?.removeEventListener("abort", abort);
        this.activeCount++;
        void Promise.resolve().then(action).then(resolve, reject).finally(() => {
          this.activeCount--;
          this.waiting.shift()?.();
        });
      };
      if (this.activeCount < this.concurrency) start();
      else { this.waiting.push(start); signal?.addEventListener("abort", abort, { once: true }); }
    });
  }
}
