// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getJobs, retryAsset } from "../src/api";

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); window.localStorage.clear(); });
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

it("keeps waiting for a generation submission instead of aborting or resubmitting", async () => {
  vi.useFakeTimers();
  let complete!: (response: Response) => void;
  const fetchMock = vi.fn((_path, init: RequestInit) => new Promise<Response>((resolve, reject) => {
    complete = resolve;
    init.signal!.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
  }));
  vi.stubGlobal("fetch", fetchMock);
  let settled = false;
  const result = retryAsset("rug", "late-asset").then(value => { settled = true; return value; });
  await vi.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
  expect(settled).toBe(false);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][1].signal!.aborted).toBe(false);
  complete(new Response(JSON.stringify({ jobIds: ["job-1"] }), { headers: { "Idempotency-Status": "complete" } }));
  await expect(result).resolves.toEqual({ jobIds: ["job-1"] });
});
