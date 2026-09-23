import { Agent, request } from "undici";
import { promisify } from "node:util";
import { gunzip, inflate, brotliDecompress } from "node:zlib";
import { AppError } from "../errors";
import { redactSecrets } from "../redact";
import { parseLaoZhangImageResponse } from "./laozhang";

const decompress = { gzip: promisify(gunzip), deflate: promisify(inflate), br: promisify(brotliDecompress) };

// No Studio-imposed connection deadline, including TLS handshake setup.
export const generationTransport = {
  createDispatcher: () => new Agent({ connectTimeout: 0 })
};

export async function requestLaoZhangImage({ endpoint, apiKey, body, signal }: {
  endpoint: string;
  apiKey: string;
  body: ReturnType<typeof import("./laozhang").buildLaoZhangRequest>;
  signal?: AbortSignal;
}) {
  // Own the connection so Cancel can also stop a stalled TLS handshake without
  // destroying another generation's socket. Request signals alone do not stop
  // Undici's connection setup before request dispatch begins.
  const dispatcher = generationTransport.createDispatcher();
  const abort = () => { void dispatcher.destroy().catch(() => undefined); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    signal?.throwIfAborted();
    const response = await request(endpoint, {
      dispatcher,
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate, br",
        Authorization: `Bearer ${apiKey}`,
        "x-goog-api-key": apiKey
      },
      body: JSON.stringify(body),
      signal,
      // A slow paid generation is not a failure. Disable both response timers,
      // including Undici's default five-minute header/body limits. Only explicit
      // cancellation or a real network/provider error ends an unfinished call.
      headersTimeout: 0,
      bodyTimeout: 0,
      idempotent: false
    });
    if (response.statusCode < 200 || response.statusCode >= 300) {
      const code = [401, 403].includes(response.statusCode) ? "AUTH_ERROR"
        : response.statusCode === 429 ? "RATE_LIMIT" : "PROVIDER_ERROR";
      // The status already establishes failure. Do not hold a queue slot waiting
      // for an error body that may never finish. Handle stream teardown errors.
      response.body.on("error", () => {});
      response.body.destroy();
      throw new AppError(502, code, `Provider returned HTTP ${response.statusCode}.`);
    }
    // Keep body-read failures distinct from malformed JSON: a disconnected
    // successful response may still have been generated (and charged) upstream.
    // Unlike fetch, request() does not decode Content-Encoding automatically.
    // Preserve support for compressed provider replies without introducing a timer.
    const encodings = String(response.headers["content-encoding"] ?? "").split(",")
      .map(value => value.trim().toLowerCase()).filter(value => value && value !== "identity");
    let text: string;
    if (encodings.length) {
      let bytes: Uint8Array = new Uint8Array(await response.body.arrayBuffer());
      for (const encoding of encodings.reverse()) {
        const decode = decompress[encoding as keyof typeof decompress];
        if (!decode) throw new AppError(502, "UNSUPPORTED_PROVIDER_ENCODING", `Unsupported provider response encoding: ${encoding}.`);
        bytes = await decode(bytes);
      }
      text = Buffer.from(bytes).toString("utf8");
    } else {
      text = await response.body.text();
    }
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      throw new AppError(502, "MALFORMED_PROVIDER_RESPONSE", "Provider returned malformed JSON.");
    }
    return await parseLaoZhangImageResponse(json);
  } catch (error) {
    // Preserve cancellation even when it happens during response download.
    signal?.throwIfAborted();
    if (error instanceof AppError) throw error;
    throw new AppError(502, "PROVIDER_OUTCOME_UNKNOWN",
      "The provider connection ended before the image was fully received. The generation may still have completed or been charged. Check provider history before retrying; Studio did not automatically resubmit it.",
      redactSecrets(error, [apiKey]));
  } finally {
    signal?.removeEventListener("abort", abort);
    await dispatcher.destroy();
  }
}
