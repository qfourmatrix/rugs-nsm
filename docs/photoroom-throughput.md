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

## Follow-up audit

The audit found and corrected gaps in pause/recovery and resource handling:

- Recheck pause before actual submission and wake rate-gated work immediately. Work that never reached HTTP returns to queued with its original request ID. Paid in-flight requests remain alive.
- Persist the ambiguous-attempt marker immediately before dispatch, after normalization and rate waiting. A crash during unsent waiting no longer falsely requires a paid retry. Record the rate timestamp after disk persistence, so slow saves cannot shift an earlier reserved burst into a later window.
- Stream source hashes and normalized multipart uploads from temporary files. Only two normalizations run at once; no retained sixty-way PNG/Blob copies. Temporary files are removed after success, failure, or an unsent pause.
- Revalidate saved cutout files and their hashes before reuse, including replay of an existing request ID. Missing/changed output requires explicit review/retry; changed base images cannot reuse stale requests.
- Keep batch ownership until every worker settles after a persistence failure. A failed pre-submission save returns the item to queued; sibling network calls remain active.

Verification: 352 tests across 62 files and production build passed. A 65-product integration test uses real streamed multipart HTTP requests against a local server, holds the first 60, verifies five unsent jobs have no attempt records, pauses without aborting active sockets, resumes, validates all 65 saved results, checks temporary-file cleanup, and reloads without duplicates. Real HTTP header/body tests advance Undici's own test clock beyond ten minutes; a real stalled TLS test waits eleven seconds. Additional tests cover rolling-window boundaries, slow persistence, disk failures, failed saved-cutout reuse and explicit retry.

Browser smoke used a disposable saved-cutout catalog with PHOTOROOM_API_KEY removed: production preview on localhost:5421, 1280×900 and 390×844, export preparation, rotate and grid controls, no framework overlay, no horizontal overflow, and no console errors. Browser plugin was unavailable; existing Playwright/Chrome performed the check. Temporary QA servers were stopped. No paid provider calls and no live catalog or recipient-process changes.

Limits: this does not verify the current provider account balance or live provider availability. The rate gate is per Studio process; restarting it resets its rolling history, and other processes sharing the key consume the same upstream allowance. Upstream 429 still pauses the batch rather than silently retrying a paid call. A process termination cannot preserve its live network connections; saved ambiguous attempts still need explicit review.

## Installer test correction

A recipient laptop failed four cutout-batch tests before installation: two exceeded Vitest's default five-second budget, one removed its fixture before final background writes completed (ENOTEMPTY), and a later fault-injection check did not settle. Production's 65-image streamed HTTP integration passed on that same laptop in 14.7 seconds.

The test fixture now waits for the queue to become idle and drains persisted writes before retry, restoring mocks, or deleting temporary data. Fault injections match their own exact batch path. A 30-second condition wait and 90-second per-test budget accommodate slow fsync without changing any app/provider timeouts. Optional RUGS_TEST_CUTOUT_DISK_DELAY_MS delays real test writes while retaining fsync and every correctness assertion.

Validation: all352 tests/62 files and build pass; all seven affected tests additionally pass with 50ms added to every real atomic write (29.5-second file duration). Only test harness and this note changed. No production source, provider limits, images, credentials or recipient files changed. Existing updater fetches this correction automatically when rerun.
