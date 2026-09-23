// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getJobs } from "../src/api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it("times out a stalled request without automatically retrying", async () => {
  vi.useFakeTimers();
  const fetchMock = vi.fn((_path, init: RequestInit) => new Promise((_resolve, reject) => {
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  const result = expect(getJobs()).rejects.toMatchObject({ code: "REQUEST_TIMEOUT" });
  await vi.advanceTimersByTimeAsync(120000);
  await result;
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
