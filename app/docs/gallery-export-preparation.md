# Gallery export preparation

Release, 25 September 2026. Installed through the existing Studio updater.

## Workflow

Select galleries, then click Export selected. The first screen opens the collection grid, with six images per page and page-scoped approval. Click any rug for original/prepared comparison, rotation and spacing. Local previews refresh automatically; paid background removal and retries require explicit actions. Continue to WebP opens the second screen with three presets; detailed encoder settings are under Advanced WebP settings. Download ZIP validates the selected files and builds the archive. The archive contains untouched originals, optimized WebPs, and a manifest recording the selected settings and source/output hashes. Nothing is uploaded to Shopify.

Main-image preparation includes Photoroom background removal, manual rotation, portrait orientation, optional uniform-border trim, square framing and background color. Every shape defaults to 5% minimum margin on each side (90% fit area). A 5% measuring grid, center lines and fit outline can be toggled; these guides never enter the exported files. Runners keep extra space along their short axis. Shared canvas edits invalidate relevant approvals. Collection layout shows six lightweight thumbnails at a time. Image detail compares a prepared uncompressed image with the actual WebP, at fit or 100% size, with dimensions and bytes. Universal WebP quality, maximum edge and lossless settings are remembered locally. The exact same encoder builds preview and final files.

## Photoroom connection and billing

Add `PHOTOROOM_API_KEY` to `app/.env.local` and restart Studio. Never commit the key. Only the server reads it. The client receives a configured/not-configured flag, never the key.

The implementation uses https://sdk.photoroom.com/v1/segment with PNG output, full size, no provider crop or generative features. Published usage price checked on 25 September 2026: $0.02/call, excluding subscription/top-up minimums and taxes. See https://docs.photoroom.com/remove-background-api-basic-plan/pricing and https://www.photoroom.com/api/pricing.

Saved attempts live under the product root at `.product-shot-queue/main-image-cutouts`. Each records its original hash, request ID, output hash, uncertainty when supplied, error, and approval. Initial requests and explicit paid retries use separate IDs. A repeated ID never resubmits the provider request, even after restart. Batch removal reuses saved cutouts and stops on failed or ambiguous attempts instead of retrying them. No request deadline or automatic provider retry is imposed. Closing the browser does not cancel an accepted server call; inspect saved attempts on return.

Each retry starts from the untouched original. Color, padding, rotation and WebP changes run locally and incur no new Photoroom usage. Provider confidence is an aid to review, not automatic approval. Main-image source changes invalidate saved-cutout applicability and preparation approval. Server export checks block unapproved cutouts and changed source images.

## Scope and limits

- No freehand mask brush in this candidate; poor cutouts can be retried explicitly or a better saved attempt selected. Do not promise identical retries will improve the result.
- Only main images undergo background removal/layout adjustments; selected gallery photos retain their composition and share WebP compression settings.
- Alpha values 1–4 outside the visible rug are ignored for bounding-box measurement, with a four-pixel fringe margin. This avoids near-transparent provider noise distorting framing. It still requires visual review.
- Production provider quality depends on the image. Six real local samples were tested separately; this is not whole-catalog acceptance.
- Defaults preserve the prior 90 quality / 4096px export when no preparation is chosen. Smaller images are not enlarged. Added canvas is padding, not upscaling.
- Export-selection's hidden 100-gallery cap was removed. Invalid/unknown/duplicate IDs still fail validation. Existing bounded encode/build queues remain.
- Read/poll requests still have a recoverable UI timeout; submissions, preflight, previews and Photoroom processing do not.

## Verification

332 tests / 58 files and production build passed; final simplified-flow browser verification is recorded in the task runbook. API integration exported 210 galleries and verified the ZIP manifest, originals and all 421 files. Browser QA exported 210 galleries through preparation, rotation approval and universal WebP controls. Preview-vs-archive exact bytes, originals preservation, input validation, settings fingerprint invalidation, provider attempt deduplication, approval and stale-source guards are covered by tests. Browser QA artifacts remain outside the repository.

User explicitly approved deployment after reviewing the working prototypes and requesting the universal 5% margin default. No provider calls are required for installation or release verification.
