# Product Shot Queue - Local App PRD

Status: Draft ready for implementation
Date: 2026-06-29
Owner: Yahya
Target build window: 2 days
Primary constraint: make the smallest reliable local tool that produces, reviews, retries, and validates product images without spiraling into app complexity.

## 1. Intent

This app is a localhost production tool for one operator working through product folders.

The input is a fixed root directory. Each direct child folder is one product/SKU. Each product folder contains one base product image named `base` with a supported image extension. The app applies 8-10 global shot prompts to each product, saves generated outputs back into that product folder, and gives the operator a simple review workflow:

1. Select product.
2. Generate missing shots for that product.
3. Review generated attempts newest first.
4. Compare a generated image against the original base image.
5. Accept, reject, or retry.
6. Move to the next product that needs work.

This is not a general image editor, prompt lab, asset manager, or multi-provider studio.

## 2. V1 Workflow Contract

V1 must keep one clear path through the app.

1. On startup, scan the configured product root.
2. Show product tabs with status badges.
3. Select one product at a time.
4. Left panel always shows generated attempts, prompt box, and job log for the selected product.
5. Right panel has two modes:
   - `Generate`: shot list and generation controls.
   - `Compare`: base image beside the selected generated image.
6. Clicking a generated image selects it and opens/updates `Compare` mode.
7. Clicking a shot loads that shot prompt into the selected product's prompt box.
8. Nothing generates unless the user clicks a generate button.
9. Bulk generation is product-local in V1.
10. Failed jobs create visible failed cards and do not stop the remaining queued jobs.

Important V1 cutline:

- P0 V1 is current-product workflow only.
- P1 adds "Next Needs Work" and selected-product batching only after P0 is stable.
- Full all-products unattended bulk generation is not P0.

## 3. P0, P1, And Deferred Scope

### P0 - Must Work First

- Fixed localhost web app.
- React/Vite frontend.
- Node backend.
- Filesystem source of truth.
- Fixed product root.
- Product scanning.
- Base image detection.
- Global master shot list.
- Product-scoped prompt box.
- Mock generator.
- Generated grid sorted newest first.
- Metadata sidecars.
- Retry exact from metadata.
- Accept and reject.
- Reject moves files to `trash/`.
- Compare mode.
- Job log.
- Basic tests for scanner, state, naming, metadata, reject, and queue rules.

### P1 - Add Only After P0 Is Stable

- Real Nano Banana Pro adapter.
- Generate missing shots for current product with concurrency 2.
- Retry failed shots.
- Next product needing work.
- Simple master shot editor or import/export.
- In-left-panel image preview with fit/zoom if compare mode is already stable.

### Deferred

- Desktop app packaging.
- Database.
- Multi-user/auth.
- Cloud storage.
- Arbitrary folder picker.
- Multi-provider support.
- Extra reference image management.
- Full prompt history browser.
- Advanced image editing tools.
- Full all-products unattended queue.
- Complex lightbox that duplicates compare mode.
- Rename/download/copy-path image management.
- Automatic image compression unless provider limits force it.

## 4. Success Criteria

The app is successful if it can reliably:

- Create or scan the configured product root.
- Detect product folders under the root.
- Identify each product's `base.*` image.
- Warn when a product has no valid base image.
- Warn when a product has multiple base images.
- Load 8-10 global shot prompts.
- Keep product prompt-box drafts isolated per product.
- Generate mock outputs end to end.
- Generate real Nano Banana Pro outputs end to end after mock flow passes.
- Save generated files and metadata under each product.
- Show generated attempts newest first.
- Retry failed or rejected attempts from stored metadata.
- Accept an output as validated.
- Reject an output by moving it to `trash/`.
- Compare base image and selected generated image side by side.
- Continue a product-local bulk run after one shot fails.
- Preserve enough metadata to debug failures and reproduce retries.
- Pass the required tests before paid generation is enabled.

The app is not successful if product scanning, generation state, file saving, review status, or retry behavior becomes ambiguous.

## 5. Current Workspace And Bootstrap Decision

Workspace:

```txt
<project folder>
```

Configured product root for this app:

```txt
<project folder>/data/nsm100k
```

Current-state note from inspection on 2026-06-29:

- `data/nsm100k/` does not currently exist.
- Existing older data appears under `data/legacy-rugs/`.
- Existing older data uses `first_image.*`, not `base.*`.

V1 decision:

- The app uses `data/nsm100k/` only.
- On startup, if `data/nsm100k/` does not exist, the backend creates it.
- The app then shows an empty-root state with setup instructions.
- There is no silent fallback to `data/legacy-rugs/`.
- There is no silent fallback to `first_image.*`.

Reason:

- Silent fallbacks create state confusion and hidden bugs.
- The user said each prepared product folder will contain a base image named `base`.
- The app enforces the clean future workflow instead of guessing against old data.

Optional migration later:

- A separate helper can copy selected folders from `data/legacy-rugs/` into `data/nsm100k/` and rename `first_image.*` to `base.*`.
- That helper is outside P0 and must never run automatically.

## 6. Filesystem Model

No database in V1.

Each product folder owns its generated assets, trash, state, and metadata.

Target structure:

```txt
data/nsm100k/
  master-shots.json
  SKU-001/
    base.jpg
    product-state.json
    generated/
      hero_2026-06-29_143022_391_a8f2c1.png
      hero_2026-06-29_143022_391_a8f2c1.json
      lifestyle_2026-06-29_143512_004_d91b22.error.json
    trash/
      hero_2026-06-29_143022_391_a8f2c1.png
      hero_2026-06-29_143022_391_a8f2c1.json
```

The app creates these automatically when missing:

- `data/nsm100k/`
- `data/nsm100k/master-shots.json`
- `<product>/generated/`
- `<product>/trash/`
- `<product>/product-state.json`

The app must not modify, move, overwrite, or delete `base.*`.

## 7. Product Scanning Rules

Supported image extensions:

- `.png`
- `.jpg`
- `.jpeg`
- `.webp`

Base image detection:

- Look for files whose basename is exactly `base`, case-insensitive.
- Extension must be supported.
- Examples accepted: `base.jpg`, `Base.PNG`, `BASE.webp`.
- Examples rejected: `first_image.jpg`, `base-final.jpg`, `base.old.png`.

Product folder rules:

- Only direct child directories of `nsm100k/` are products.
- Hidden folders are ignored.
- `generated/`, `trash/`, and other nested folders are never products.
- Symlinks are ignored in V1.
- Empty product folders appear with a missing-base warning.
- Product display name is the folder name.
- Internal API calls use URL-encoded product IDs mapped to scanned folder records.
- The backend never joins raw request path segments into filesystem paths without validation.

Duplicate base rule:

- If more than one supported `base.*` file exists, the product is invalid for generation.
- UI shows `Multiple base images`.
- The operator must remove or rename extras.
- The app does not choose one automatically.

Corrupt image rule:

- P0 validates image type by extension only.
- P1 validates dimensions/decoding before provider calls.
- If decoding fails, mark product as invalid and do not generate.

## 8. Master Shots

Global master shot file:

```txt
nsm100k/master-shots.json
```

This file defines the reusable prompt template set shared by every product.

Initial placeholder shots:

1. `hero`
2. `lifestyle`
3. `detail`
4. `close_up`
5. `room_scene`
6. `angle_view`
7. `texture_focus`
8. `scale_context`
9. `catalog_clean`
10. `premium_editorial`

Required schema:

```json
{
  "version": 1,
  "updatedAt": "2026-06-29T00:00:00.000Z",
  "shots": [
    {
      "id": "hero",
      "name": "Hero",
      "prompt": "Create a clean premium hero product image using the base product as the exact product reference.",
      "defaultAspectRatio": "1:1",
      "defaultImageSize": "4K"
    }
  ]
}
```

Validation rules:

- `version` must be `1`.
- `shots` must contain 1-20 shots.
- Shot `id` must be unique.
- Shot `id` must match `^[a-z0-9_]+$`.
- Shot `name` must be non-empty.
- Shot `prompt` must be non-empty.
- Shot order is the array order.
- `defaultAspectRatio` must be supported.
- `defaultImageSize` must be supported.
- Invalid JSON or invalid schema blocks generation and shows a readable error.

Missing-file rule:

- If `master-shots.json` is missing, the app creates it with the placeholder shots.
- If the file exists but is invalid, the app never overwrites it automatically.

Editing rule:

- P0 edits this file directly on disk and uses `Reload Shots`.
- P1 adds a simple explicit-save shot editor only after P0 is stable.
- No autosave for global master prompts.

## 9. Prompt State Contract

There are two prompt concepts:

- `Master prompt`: the global template in `master-shots.json`.
- `Prompt box`: the selected product's current working prompt draft.

P0 does not need product-specific shot overrides. Generated metadata is the prompt history.

Product state file:

```json
{
  "version": 1,
  "productId": "SKU-001",
  "selectedShotId": "hero",
  "selectedAssetId": null,
  "promptBox": {
    "value": "Current editable prompt for this product.",
    "sourceShotId": "hero",
    "dirty": true,
    "updatedAt": "2026-06-29T14:30:22.000Z"
  },
  "settings": {
    "aspectRatio": "1:1",
    "imageSize": "4K",
    "concurrency": 2
  }
}
```

Prompt behavior:

- Each product has its own prompt box.
- Prompt box changes are saved to that product's `product-state.json`.
- Switching products restores that product's last prompt box.
- Clicking a shot sets `selectedShotId` and replaces the prompt box with that shot's master prompt.
- If the current prompt box has unsaved local edits, those edits are already persisted as the product draft before replacement.
- Generating from the prompt box uses the current `selectedShotId`.
- If no shot is selected, the generate button is disabled.
- Jobs snapshot prompt, settings, base image metadata, and shot ID at enqueue time.
- Later prompt edits do not mutate already queued or completed jobs.

This removes ambiguity between experimenting on one product and editing global templates.

## 10. Generated Assets And Metadata

Every successful generated image has a sidecar JSON file with the same basename.

Every failed generation has an `.error.json` file and no image file.

Filename format:

```txt
{shotId}_{YYYY-MM-DD}_{HHmmss}_{SSS}_{suffix}.png
{shotId}_{YYYY-MM-DD}_{HHmmss}_{SSS}_{suffix}.json
{shotId}_{YYYY-MM-DD}_{HHmmss}_{SSS}_{suffix}.error.json
```

Example:

```txt
hero_2026-06-29_143022_391_a8f2c1.png
hero_2026-06-29_143022_391_a8f2c1.json
lifestyle_2026-06-29_143512_004_d91b22.error.json
```

Rules:

- Timestamp uses local time for human readability.
- `suffix` is a short random or monotonic ID.
- The backend reserves filenames atomically before writing.
- Same-shot concurrent generations must never collide.
- The app never overwrites generated images or metadata.

Successful metadata shape:

```json
{
  "version": 1,
  "assetId": "hero_2026-06-29_143022_391_a8f2c1",
  "productId": "SKU-001",
  "shotId": "hero",
  "shotName": "Hero",
  "status": "done",
  "attempt": 1,
  "parentAssetId": null,
  "createdAt": "2026-06-29T14:30:22.391Z",
  "prompt": "Exact prompt sent to the API.",
  "masterShotsVersion": 1,
  "settings": {
    "provider": "laozhang",
    "model": "gemini-3-pro-image-preview",
    "aspectRatio": "1:1",
    "imageSize": "4K"
  },
  "inputs": {
    "baseImage": {
      "file": "base.jpg",
      "sha256": "base-image-sha256",
      "sizeBytes": 123456,
      "mtimeMs": 1782730000000,
      "mimeType": "image/jpeg"
    },
    "references": []
  },
  "output": {
    "file": "hero_2026-06-29_143022_391_a8f2c1.png",
    "mimeType": "image/png",
    "sizeBytes": 234567
  },
  "provider": {
    "requestId": null,
    "durationMs": 10342,
    "normalizedStatus": "success",
    "requestPreview": {
      "responseModalities": ["IMAGE"],
      "aspectRatio": "1:1",
      "imageSize": "4K",
      "inputImageCount": 1
    }
  },
  "error": null
}
```

Failed metadata shape:

```json
{
  "version": 1,
  "assetId": "lifestyle_2026-06-29_143512_004_d91b22",
  "productId": "SKU-001",
  "shotId": "lifestyle",
  "shotName": "Lifestyle",
  "status": "failed",
  "attempt": 1,
  "parentAssetId": null,
  "createdAt": "2026-06-29T14:35:12.004Z",
  "prompt": "Exact prompt attempted.",
  "settings": {
    "provider": "laozhang",
    "model": "gemini-3-pro-image-preview",
    "aspectRatio": "1:1",
    "imageSize": "4K"
  },
  "inputs": {
    "baseImage": {
      "file": "base.jpg",
      "sha256": "base-image-sha256",
      "sizeBytes": 123456,
      "mtimeMs": 1782730000000,
      "mimeType": "image/jpeg"
    },
    "references": []
  },
  "output": null,
  "provider": {
    "requestId": null,
    "durationMs": 14001,
    "normalizedStatus": "provider_error",
    "requestPreview": {
      "responseModalities": ["IMAGE"],
      "aspectRatio": "1:1",
      "imageSize": "4K",
      "inputImageCount": 1
    }
  },
  "error": {
    "message": "Provider returned no image data.",
    "code": "NO_IMAGE_DATA",
    "raw": {}
  }
}
```

Security rule:

- `raw` errors must be redacted before saving.
- API keys must never appear in metadata, logs, errors, or UI.

## 11. Status And Shot Aggregation

Persisted asset statuses:

- `done`: generated successfully, not yet validated.
- `accepted`: validated by the operator.
- `rejected`: moved to `trash/`.
- `failed`: attempted and failed.

Runtime job statuses:

- `queued`: waiting to run.
- `generating`: provider request in progress.
- `succeeded`: completed and persisted as `done`.
- `failed`: completed and persisted as failed metadata.
- `cancelled`: pending job cancelled before provider call.

`accepted` means validated.

Shot aggregate state for one product and one shot:

- `generating`: any runtime job for this product+shot is queued or generating.
- `accepted`: one or more active generated assets for this shot is accepted.
- `review_needed`: one or more active generated assets is `done`, and none is accepted.
- `failed`: latest attempt is failed, no active `done` or `accepted`, and no runtime job.
- `empty`: no active `done` or `accepted`, no failed attempt, and no runtime job.
- `rejected_only`: only trashed/rejected attempts exist.

Active output:

- A generated image in `generated/` with metadata status `done` or `accepted`.

Generate Missing rule:

- Enqueue only shots whose aggregate state is `empty`.
- Skip `accepted`.
- Skip `review_needed`.
- Skip `generating`.
- Skip `failed`; use `Retry Failed`.
- Skip `rejected_only`; use `Retry Exact` from a rejected card or `Generate From Prompt Box`.

Reason:

- This prevents duplicate paid calls for unreviewed `done` attempts.
- It separates first-pass generation from retry/regeneration.

Accepted-output rule:

- V1 allows one accepted output per shot.
- Accepting a new output for a shot changes any previous active accepted output for that same shot back to `done`.
- Rejected accepted outputs move to trash like any other rejected image.

## 12. Accept, Reject, Retry

Accept:

- Updates the asset metadata status to `accepted`.
- Does not move the image.
- Is idempotent.
- If the asset is already accepted, return success with no file change.
- Failed assets cannot be accepted.

Reject:

- Updates metadata status to `rejected`.
- Atomically moves image and sidecar metadata from `generated/` to `trash/`.
- Is idempotent.
- If the asset is already in trash, return success with current state.
- If image exists but sidecar is missing, show an orphan warning and do not delete the image.
- If trash filename collides, append a suffix.
- Failed assets cannot be rejected in P0 because they have no image output.
- Failed `.error.json` files stay in `generated/` and are handled through `Retry Failed`.

Retry Exact:

- Uses the original metadata:
  - prompt
  - shotId
  - aspect ratio
  - image size
  - provider/model
  - base image file identity
  - references, when supported later
- Creates a new asset with `attempt = parent.attempt + 1`.
- Sets `parentAssetId` to the retried asset.
- If the current base image hash differs from the stored hash, show a warning before running.

Generate From Prompt Box:

- Uses current prompt box and current settings.
- Creates a new independent attempt.

Duplicate-click guard:

- If a runtime job already exists for product+shot, additional generate requests return a 409-style validation error and do not enqueue another provider call.

## 13. UI Layout

Visual direction:

- Clean dense Apple-style local utility.
- Light mode first.
- Desktop/laptop first.
- Quiet grays, white panels, precise dividers, compact controls.
- Image review dominates the visual hierarchy.
- No decorative hero sections, marketing copy, or large explanatory cards.

Top bar:

- Horizontally scrollable product tabs.
- Rescan button.
- Search/filter by product name if product count becomes large.
- Product status badges:
  - `accepted/10`
  - `review`
  - `failed`
  - `missing base`
  - `running`

Main layout:

```txt
+----------------------------------------------------------------+
| Product tabs: SKU-001  SKU-002  SKU-003 ...      Rescan        |
+--------------------------------+-------------------------------+
| Left Panel                     | Right Panel                   |
| Generated attempts grid        | Generate mode or Compare mode |
| Prompt box                     |                               |
| Job log                        |                               |
+--------------------------------+-------------------------------+
```

Left panel:

- Always visible.
- Generated attempts grid.
- Newest first.
- Cards show thumbnail, shot name, status, timestamp, retry, accept, reject.
- Failed cards show readable error summary.
- Rejected cards are hidden by default.
- `Show Trash` toggle reveals rejected cards as greyed out.
- Prompt box scoped to selected product.
- Compact job log.

Right panel:

- `Generate` mode for shot list and controls.
- `Compare` mode for base image beside selected generated image.

## 14. Generate Mode

Generate mode shows master shots in order.

Each row includes:

- Shot name.
- Aggregate state.
- Effective master prompt preview.
- `Load Prompt`.
- `Generate From Prompt Box`.
- `Retry Failed` when latest state is failed.

Top-level controls:

- `Generate Missing Shots` for current product.
- `Retry Failed Shots` for current product.
- `Cancel Pending` for jobs not yet sent to the provider.

Controls that call the paid provider must show:

- Number of images about to be generated.
- Current provider mode.
- Aspect ratio.
- Image size.
- Confirmation for more than one image.

No control may generate on hover, selection, tab switch, prompt edit, reload, or rescan.

## 15. Compare Mode

Compare mode is the primary review surface.

Behavior:

- Left side: selected product base image.
- Right side: selected generated image.
- Both images fit within the right panel without cropping by default.
- The selected generated image changes from the left grid or compare controls.

Controls:

- Previous generated image.
- Next generated image.
- Accept.
- Reject.
- Retry Exact.
- Return to Generate.

Failed asset behavior:

- If selected asset is failed, Compare shows base image plus error details instead of a generated image.

## 16. Left-Panel Preview

Earlier concept included a full practical lightbox inside the left panel. For the 2-day V1, avoid duplicating compare mode.

P0 behavior:

- Clicking a generated card selects it and opens/updates Compare mode.
- P0 does not implement a separate preview drawer.
- Any future left-panel preview must never cross into the right panel.

P1 behavior after P0 is stable:

- Add contained left-panel fit/zoom.
- Add next/previous inside the left panel.
- Keep accept/reject/retry controls shared with selected asset state.

Deferred:

- A separate full-feature lightbox that duplicates Compare.

## 17. Reference Image Handling

P0:

- Always send the base image as the only image input.
- Do not build extra reference selection UI.

P1 or later:

- Product folder can contain `references/`.
- User can select extra references for a job.
- Persist selected references in product state.
- Store reference hashes in metadata.
- Limit UI default to base plus up to 3 additional references.

Provider docs indicate Nano Banana Pro supports multi-image reference input up to 14 images, but managing references is a separate reliability problem and does not block P0.

## 18. Provider Integration

Provider:

- LaoZhang API.
- Nano Banana Pro.
- Model: `gemini-3-pro-image-preview`.
- Mode: Google native format.

Endpoint:

```txt
https://api.laozhang.ai/v1beta/models/gemini-3-pro-image-preview:generateContent
```

Authentication:

- Store API key in `.env.local`.
- Env var name: `LAOZHANG_API_KEY`.
- Include `.env.local` in `.gitignore`.
- Provide `.env.example` without secrets.
- Use `Authorization: Bearer ${LAOZHANG_API_KEY}` by default.
- `x-goog-api-key` is acceptable if needed.
- Never put the key in the URL query string.
- Validate key presence at backend startup if real provider mode is enabled.
- The key pasted in chat should be treated as exposed and rotated.

Request shape:

```json
{
  "contents": [
    {
      "role": "user",
      "parts": [
        {
          "text": "Exact prompt sent to the provider."
        },
        {
          "inline_data": {
            "mime_type": "image/jpeg",
            "data": "BASE64_IMAGE_DATA"
          }
        }
      ]
    }
  ],
  "generationConfig": {
    "responseModalities": ["IMAGE"],
    "imageConfig": {
      "aspectRatio": "1:1",
      "imageSize": "4K"
    }
  }
}
```

Request rules:

- Text part comes first.
- Base image part comes second.
- Local images use Base64 `inline_data`.
- Use the real MIME type from the base file.
- Do not use local file URLs.
- Store only request preview metadata, not Base64 image data.

Response extraction:

```txt
candidates[0].content.parts[*].inlineData.data
```

Rules:

- Find the first part with `inlineData.data`.
- Decode Base64 and write PNG output unless the provider returns another clear image MIME.
- If HTTP response is successful but no image data exists, save failed metadata with code `NO_IMAGE_DATA`.
- If response JSON is malformed, save failed metadata with code `MALFORMED_PROVIDER_RESPONSE`.
- Provider timeout saves failed metadata with code `PROVIDER_TIMEOUT`.
- 401/403 normalizes to `AUTH_ERROR`.
- 429 normalizes to `RATE_LIMIT`.
- 5xx normalizes to `PROVIDER_ERROR`.

Docs checked on 2026-06-29:

- https://docs.laozhang.ai/en/api-capabilities/nano-banana-pro-image-edit
- https://docs.laozhang.ai/en/api-capabilities/nano-banana-pro-image

Verified details from docs:

- Model ID: `gemini-3-pro-image-preview`.
- Google native endpoint path uses `:generateContent`.
- 2K/4K and custom aspect ratio use `generationConfig.imageConfig`.
- Image size values must use uppercase `K`: `1K`, `2K`, `4K`.
- Local image input can use Base64 `inline_data`.
- Output image data is Base64 in `inlineData.data`.
- Multi-image reference is documented up to 14 images.

## 19. Settings

P0 image sizes:

- `1K`
- `2K`
- `4K`

Default:

- `4K`

P0 aspect ratios for image editing:

- `1:1`
- `16:9`
- `9:16`
- `4:3`
- `3:4`

Default:

- `1:1`

Reason:

- The image-editing docs currently show these five ratios in the supported resolution table.
- More ratios are exposed only after adapter tests prove they work for image editing.

## 20. Queue And Jobs

V1 queue type:

- In-memory backend queue.
- Filesystem remains the durable source of truth.
- Browser refresh does not cancel backend jobs.
- Backend restart cancels volatile queued/in-flight jobs.
- No durable job resume in V1.

Concurrency:

- Default: 2.
- Minimum: 1.
- Maximum: 3 in V1.
- Current-product queue only in P0.

Run model:

- Bulk actions create a `runId`.
- Each generated shot creates a `jobId`.
- Job snapshots prompt/settings/input identity at enqueue time.
- Queue continues after failure.
- Pending jobs can be cancelled.
- In-flight provider calls are allowed to finish.

Job log:

- Show start, success, failure, retry, accept, reject, cancel.
- Store job log as append-only JSONL.
- Redact secrets before writing.

## 21. API Contract

All filesystem and provider operations live in the backend.

Frontend never:

- Reads arbitrary filesystem paths directly.
- Holds the API key.
- Builds provider requests.
- Joins raw paths.

Recommended endpoints:

```txt
GET    /api/products
GET    /api/products/:productId
GET    /api/products/:productId/image/:kind/:filename
GET    /api/master-shots
PUT    /api/master-shots
GET    /api/products/:productId/state
PUT    /api/products/:productId/state
GET    /api/products/:productId/generated
POST   /api/products/:productId/generate
POST   /api/products/:productId/generate-missing
POST   /api/products/:productId/retry-failed
POST   /api/products/:productId/generated/:assetId/retry
POST   /api/products/:productId/generated/:assetId/accept
POST   /api/products/:productId/generated/:assetId/reject
POST   /api/jobs/:jobId/cancel
GET    /api/jobs
```

Image endpoint rules:

- `kind` is one of `base`, `generated`, `trash`.
- `filename` must be a basename only.
- Reject path traversal.
- Reject unknown product IDs not present in latest scan.

Generate request:

```json
{
  "shotId": "hero",
  "prompt": "Prompt box value.",
  "settings": {
    "aspectRatio": "1:1",
    "imageSize": "4K"
  },
  "source": "prompt_box"
}
```

Generate response:

```json
{
  "runId": "run_2026-06-29_143022_391",
  "jobIds": ["job_abc123"]
}
```

Accept/reject/retry responses return the updated asset record or a validation error.

Validation errors use this structure:

```json
{
  "error": {
    "code": "MISSING_BASE_IMAGE",
    "message": "This product has no base image named base.*."
  }
}
```

Use runtime schema validation for:

- `master-shots.json`
- `product-state.json`
- generated metadata
- API request bodies
- provider response fixtures

Zod is a good default for a TypeScript implementation; an equivalent runtime validator is acceptable.

## 22. Error Handling

Required readable errors:

- Missing product root.
- No product folders found.
- Missing base image.
- Multiple base images found.
- Unsupported image extension.
- Invalid master shots JSON.
- Invalid master shots schema.
- Duplicate shot IDs.
- Invalid product state JSON.
- Malformed generated metadata.
- Orphan image without metadata.
- Orphan metadata without image.
- Provider authentication failure.
- Provider rate limit.
- Provider timeout.
- Provider 5xx error.
- Provider response has no image data.
- File write failure.
- Trash move failure.
- Duplicate generate request already queued/running.

Display rules:

- Product-level errors appear on product tabs and product header.
- Shot-level errors appear in shot rows and generated cards.
- Job-level errors appear in job log.
- Failed provider jobs create failed cards.
- One bad product must not crash the whole app.
- One failed shot must not stop a bulk run.

## 23. Data Safety Rules

The app must be conservative with files.

Rules:

- Never delete the base image.
- Never overwrite generated images.
- Never overwrite existing metadata.
- Never silently choose between multiple base images.
- Never silently fallback to old folders.
- Move rejected images to `trash/`.
- Keep rejected metadata with rejected image.
- Write JSON atomically:
  - write temp file
  - fsync where practical
  - rename into place
- Use path allowlists from scanner results.
- Redact secrets from logs and metadata.

## 24. Mock Generator

Mock generation is mandatory before real provider wiring.

Mock provider contract:

- Implements the same interface as real provider.
- Produces image files and metadata in the same paths.
- Uses deterministic fixture images.
- Supports deterministic success.
- Supports deterministic failure trigger, for example prompt contains `[fail]`.
- Supports deterministic latency, for example 500-1500 ms.
- Never calls the network.
- Exercises the same queue, status, retry, accept, reject, and compare flows.

Gate:

- Do not enable real provider mode until mock generation passes the required workflow and tests.

## 25. Required Tests

Minimum P0 tests:

- Product scanner creates root when missing.
- Product scanner detects direct child folders.
- Product scanner ignores hidden folders and nested folders.
- Product scanner finds `base.*` across supported extensions.
- Product scanner rejects duplicate bases.
- Product scanner warns on missing base.
- Product ID URL encoding prevents path traversal.
- Master shots loads valid JSON.
- Master shots creates placeholders when missing.
- Master shots rejects invalid JSON.
- Master shots rejects duplicate IDs.
- Master shots rejects unsupported aspect/image size.
- Product state saves and reloads.
- Prompt box state is isolated across products.
- Clicking a shot replaces only the selected product prompt box.
- Job snapshots prompt/settings at enqueue time.
- Filename builder avoids same-millisecond/same-shot collisions.
- Metadata sidecar path matches image path.
- Failed generation writes `.error.json`.
- Generated grid sorts newest first.
- Generate Missing enqueues only `empty` shots.
- Generate Missing skips `review_needed`, `accepted`, `failed`, and `generating`.
- Duplicate generate click does not create duplicate provider jobs.
- Retry Exact uses original metadata.
- Accept is idempotent.
- Reject moves image and metadata to `trash/`.
- Reject is idempotent.
- Trash filename collision appends a suffix.
- Orphan image/metadata states are shown without destructive cleanup.
- Provider adapter fixture handles success.
- Provider adapter fixture handles HTTP 200 with no image.
- Provider adapter fixture handles auth failure.
- Provider adapter fixture handles rate limit.
- Provider adapter fixture handles timeout.
- Provider adapter fixture handles malformed JSON.
- Secret redaction removes API keys from stored errors/logs.

Manual P0 workflow check:

1. Create 2-3 sample products under `nsm100k/`.
2. Include one valid base, one missing base, and one duplicate base case.
3. Run app.
4. Confirm product tabs and warnings.
5. Generate mock shots.
6. Accept one.
7. Reject one.
8. Retry one.
9. Confirm reload preserves state.
10. Confirm Compare mode works.

Manual P1 real-provider check:

1. Enable real provider with `LAOZHANG_API_KEY`.
2. Generate one shot with concurrency 1.
3. Generate two shots with concurrency 2.
4. Trigger or simulate one provider failure.
5. Confirm failed card and metadata.
6. Confirm no API key appears in logs or metadata.

## 26. Build Sequence

### Phase 1 - Skeleton And Scanner

Goal: prove product discovery and navigation.

Deliverables:

- React/Vite frontend.
- Node backend.
- Fixed root config.
- Bootstrap `nsm100k/`.
- Product scanner.
- Product tabs with warnings.
- Base image serving.
- Placeholder `master-shots.json`.
- Empty generated grid.

Verification:

- Product root exists.
- Valid product appears.
- Missing-base product warns.
- Duplicate-base product warns.

### Phase 2 - State And Mock Generation

Goal: prove the workflow without paid API calls.

Deliverables:

- Product state read/write.
- Product-scoped prompt box.
- Mock provider.
- Generated assets and metadata.
- Failed mock metadata.
- Accept/reject/retry.
- Job log.
- Compare mode.

Verification:

- Mock generate succeeds.
- Mock failure creates failed card.
- Accept/reject survive reload.
- Retry creates a new attempt.
- Compare mode updates from grid selection.

### Phase 3 - Queue

Goal: prove bulk behavior before real provider integration.

Deliverables:

- Generate one selected shot.
- Generate Missing for current product.
- Retry Failed for current product.
- Concurrency limit.
- Duplicate-click guard.
- Cancel pending.

Verification:

- Simulated failures do not stop queue.
- Generate Missing skips unreviewed done shots.
- Runtime job states match persisted metadata.

### Phase 4 - Real Nano Banana Pro Adapter

Goal: swap mock provider for real provider behind the same interface.

Deliverables:

- `.env.local` loading.
- `.env.example`.
- `.gitignore` update.
- Base image Base64 encoding.
- Google native request builder.
- Response image extraction.
- Provider error normalization.
- Secret redaction.

Verification:

- One real generation works.
- Failed provider response creates failed metadata.
- Metadata captures prompt/settings/inputs without API key.

### Phase 5 - Hardening

Goal: remove obvious reliability and UX traps.

Deliverables:

- Empty states.
- Better error messages.
- Product status badges.
- Next Needs Work.
- Basic browser screenshot check.
- README setup/run instructions.

Verification:

- End-to-end run on a small real batch.
- No ambiguous status states.
- No destructive file behavior.

## 27. Definition Of Done For V1

V1 is done when:

- The app runs locally on `localhost`.
- It uses `<project folder>/data/nsm100k`, independent of the Mac username.
- It creates the root if missing.
- It scans products and base images.
- It displays product tabs with useful status.
- It loads and validates master shots.
- It supports product-specific prompt box state.
- It can generate mock outputs end to end.
- It can generate real Nano Banana Pro outputs end to end.
- It saves outputs and metadata under each product.
- It can generate missing shots for the current product.
- It can retry failed/existing attempts.
- It can accept/validate.
- It can reject to trash.
- It can compare base and generated images side by side.
- It shows failures without crashing.
- It avoids duplicate paid calls from repeated clicks.
- Required tests pass.
- Setup instructions exist.

## 28. Implementation Bias

When in doubt, choose boring, explicit, local, and testable.

Default technical choices:

- React + Vite.
- Node backend.
- TypeScript if it speeds validation and reduces ambiguity.
- Runtime schemas for file/API boundaries.
- Filesystem as source of truth.
- No database.
- Fixed root path.
- Mock provider first.
- Real provider second.
- Small backend modules:
  - config
  - scanner
  - schema validation
  - state store
  - asset store
  - queue
  - mock provider
  - LaoZhang provider
  - job log

The app must feel like a production workstation utility, not a creative sandbox.
