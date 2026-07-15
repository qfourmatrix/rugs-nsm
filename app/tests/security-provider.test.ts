import { describe, expect, it } from "vitest";
import { redactSecrets } from "../server/redact";

async function loadLaoZhangProvider(): Promise<{
  parseLaoZhangImageResponse: (responseBody: unknown) => Promise<unknown> | unknown;
  buildLaoZhangRequest: (input: {
    prompt: string;
    base64Image: string;
    mimeType: string;
    aspectRatio: string;
    imageSize: string;
    references?: Array<{ base64: string; mimeType: string }>;
  }) => unknown;
}> {
  return import("../server/providers/laozhang");
}

function providerCode(value: unknown): string | undefined {
  if (value && typeof value === "object") {
    const candidate = value as {
      code?: string;
      errorCode?: string;
      error?: { code?: string };
      normalizedStatus?: string;
    };

    return candidate.code ?? candidate.errorCode ?? candidate.error?.code ?? candidate.normalizedStatus;
  }

  return undefined;
}

describe("secret redaction and provider parsing", () => {
  it("redacts API keys from nested log/error payloads", () => {
    const exposedKey = "lz_live_exposed_key_rotate_me";
    const redacted = redactSecrets(
      {
        message: `Provider failed with LAOZHANG_API_KEY=${exposedKey}`,
        headers: {
          authorization: `Bearer ${exposedKey}`,
          "x-goog-api-key": exposedKey
        },
        nested: [{ raw: `curl -H 'Authorization: Bearer ${exposedKey}'` }]
      },
      [exposedKey]
    );
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain(exposedKey);
    expect(serialized).toMatch(/redacted/i);
  });

  it("normalizes HTTP 200 provider responses with no inline image data", async () => {
    const noImageResponse = {
      candidates: [
        {
          content: {
            parts: [{ text: "I cannot produce an image for this request." }]
          }
        }
      ]
    };

    const { parseLaoZhangImageResponse } = await loadLaoZhangProvider();
    let parsedOrThrown: unknown;
    try {
      parsedOrThrown = await parseLaoZhangImageResponse(noImageResponse);
    } catch (error) {
      parsedOrThrown = error;
    }

    expect(providerCode(parsedOrThrown)).toBe("NO_IMAGE_DATA");
  });

  it("builds native provider requests with base image plus references", async () => {
    const { buildLaoZhangRequest } = await loadLaoZhangProvider();
    const body = buildLaoZhangRequest({
      prompt: "Use all input images",
      base64Image: "base64-base",
      mimeType: "image/png",
      aspectRatio: "1:1",
      imageSize: "4K",
      references: [
        { base64: "base64-ref-1", mimeType: "image/jpeg" },
        { base64: "base64-ref-2", mimeType: "image/webp" }
      ]
    }) as {
      contents: Array<{
        parts: Array<{ text?: string; inline_data?: { data: string; mime_type: string } }>;
      }>;
      generationConfig: {
        imageConfig: {
          aspectRatio: string;
          imageSize: string;
        };
      };
    };

    const imageParts = body.contents[0].parts.filter((part) => part.inline_data);

    expect(imageParts.map((part) => part.inline_data?.data)).toEqual([
      "base64-base",
      "base64-ref-1",
      "base64-ref-2"
    ]);
    expect(body.generationConfig.imageConfig).toEqual({
      aspectRatio: "1:1",
      imageSize: "4K"
    });
  });
});
