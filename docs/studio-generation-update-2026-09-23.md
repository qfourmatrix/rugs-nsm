# Studio generation update — September 23, 2026

Studio now runs up to twelve image jobs concurrently. Generate Selected becomes available again once a submission is accepted, so another attempt of the same shot can use a different background while earlier attempts run. Each attempt retains its own prompt, background snapshot and result. Queue indicators count jobs, including multiple attempts of one shot.

Generation submissions and provider connection/header/body waits have no Studio-imposed time limit. Manual Cancel remains available. Explicit HTTP errors stop the affected request promptly, including errors with an unfinished body. Gzip, deflate and Brotli responses are supported. Connection loss is reported as an uncertain provider outcome and is never automatically resubmitted. Request identity protection and restart recovery remain intact.

## Install

1. Let active generations finish, save edits, then stop Studio with Control-C in its Terminal window. Keep live catalog synchronization paused.
2. In the existing outer app folder, run `3 Update RUGS NSM.command` and wait for `Update complete`.
3. Run `2 Start RUGS NSM.command`. Confirm the footer says `Queue: 12`.

No replacement background pack is needed. Use the existing updater to preserve the catalog and private configuration. Publication does not establish that a particular laptop has installed the release.

## Verification and limits

The isolated candidate passed a fresh npm ci, 311 tests across 54 files, TypeScript and production build. Thirteen-job mock tests verified twelve active plus one queued, cancellation freeing a slot, same-shot attempts, separate saved outputs and duplicate-request replay. Twelve local HTTP requests verified that cancelling one preserves the other eleven. Tests cover slow responses, stalled TLS, interrupted bodies, explicit errors and compressed replies. Crash/restart checks across all seven generation routes made no replacement calls.

Browser QA submitted two simultaneous Wide Room attempts with different backgrounds, verified the Generate button stayed usable and each saved result retained its background and attempt number, then exercised completion previews, Compare, acceptance, readiness and ZIP export. Four portable installer regressions also passed. No paid generation or twelve-call provider-account load test was performed. Existing dependency audit and bundle-size advisories remain.

A silent request can remain active until manually cancelled. Connection loss or a server restart can still lose a synchronous response; check provider history before retrying uncertain work. Twelve is Studio's capacity, not a verified account-specific provider guarantee.

## Rollback

Older releases reject newly saved `settings.concurrency: 12`. Do not perform a blind code-only downgrade after using this release. Stop Studio and preserve the current catalog state and job ledger before any compatibility conversion or rollback. Keep new generated images intact. See [history recovery and rollback](studio-performance-rollback.md).
