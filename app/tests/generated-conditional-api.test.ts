// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { getGenerated } from "../src/api";
afterEach(() => vi.unstubAllGlobals());
it("reuses the identical response on304 without parsing and scopes tags to the product", async () => {
  const payload = { generated: { active: [], trash: [], aggregates: {} } };
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { headers: { ETag: 'W/"generated-one"' } }))
    .mockResolvedValueOnce(new Response(null, { status: 304 }))
    .mockResolvedValueOnce(new Response(JSON.stringify(payload), { headers: { ETag: 'W/"generated-two"' } }));
  vi.stubGlobal("fetch", fetchMock);
  const first = await getGenerated("a");
  expect(await getGenerated("a", undefined, first)).toBe(first);
  expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBe('W/"generated-one"');
  const other = await getGenerated("b", undefined, first);
  expect(other).not.toBe(first);
  expect(fetchMock.mock.calls[2][1].headers["If-None-Match"]).toBeUndefined();
});
it("does not cache an unvalidated tag and replaces data on a changed response", async () => {
  const payload = { generated: { active: [], trash: [], aggregates: {} } };
  const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify(payload), { headers: { ETag: 'W/"ordinary-express-tag"' } }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ generated: { ...payload.generated, aggregates: { hero: "running" } } })));
  vi.stubGlobal("fetch", fetchMock);
  const first = await getGenerated("a");
  const second = await getGenerated("a", undefined, first);
  expect(second.aggregates.hero).toBe("running");
  expect(fetchMock.mock.calls[1][1].headers["If-None-Match"]).toBeUndefined();
});
