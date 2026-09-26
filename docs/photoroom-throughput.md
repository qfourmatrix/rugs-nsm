# Photoroom background-removal throughput

Verified September 26, 2026 against https://docs.photoroom.com/getting-started/frequently-asked-questions:

- Default allowance is 60 images per minute. Parallel API calls are supported; no separate concurrent-request maximum is published. Higher rate limits require an Enterprise arrangement.
- Studio permits 60 simultaneous cutout operations instead of four. This is Studio's capacity, not a claimed provider concurrency limit.
- Batch and individual requests share a rolling 60-starts-per-60-seconds gate within one Studio server. The first allowance can launch without the former 1050ms per-request delay. Further requests wait for allowance; active requests remain untouched. Separate Studio processes or other users of the same API key share the provider allowance but not this process-local gate. HTTP 429 pauses the batch for review.
- Local PNG normalization uses two workers independently of network requests to avoid running sixty CPU-heavy conversions simultaneously.
- Connection, response-header and response-body timeouts remain disabled. There is no overall request deadline. Real network/provider errors still fail the attempt; no automatic paid retry or redirect follows.
- Durable request IDs and successful cutouts remain reusable. The batch can queue the whole existing 5000-image selection limit; that is a local queue, not a Photoroom bulk endpoint.

Validation: rolling-window boundary/burst tests, a 65-image batch with 60 held requests, persisted results, failure isolation, credit pause/retry and recovery tests, ten-minute simulated response, and a real local stalled TLS connection beyond eleven seconds. No paid provider calls. Full suite and production build passed; existing client bundle warning unchanged.

Install with the existing export updater after active requests have finished. Publication does not update an already-running Studio process. Restarting a process cannot preserve an in-flight TCP request; ambiguous saved attempts require explicit review rather than automatic resubmission.
