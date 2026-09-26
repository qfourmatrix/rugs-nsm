# Export formats and collection review

Studio preparation displays all selected families in one scrollable collection, grouped Area / Runner / Round. Images load lazily and offscreen families defer painting. Preview rendering remains limited to two concurrent local requests, retaining the latest preview for each product; changing one rug does not rerender every unchanged image.

**Approve all** approves matching, completed previews across the selection, including families hidden by search. Failed, queued, processing, stale or unreadable images are skipped. A failure on one approval does not discard other successful approvals. Rotation or canvas changes require another approval.

**Transparent background** applies to prepared main-image canvases. Apply collection settings to all main images, or adjust a single image in Image detail. Turning it off uses the chosen canvas color. Transparent exports require a saved, source-matched, approved background-removal result. This control does not call Photoroom.

The download step offers:

- **Shopify WebPs**: the full selected galleries, with the selected WebP quality and maximum edge. Main images use the chosen transparency/canvas setting; generated room scenes stay intact.
- **Room-viewer PNGs**: main-rug cutouts only, always transparent, losslessly encoded. Rotation, proportional framing, margin and maximum edge are retained. WebP quality does not affect PNG compression. Smaller source images are never enlarged.

Both ZIPs include untouched source originals and a manifest. Prepared PNGs are in each shape's `room-viewer` folder; WebPs remain in `shopify`. Format is included in validation fingerprints and conversion cache keys. Missing or unapproved cutouts block transparent export instead of silently exporting an opaque image.

Validation: 357 tests in 62 files; production build; desktop 1280×900 and mobile 390×844 production-browser checks, six saved cutouts across four families, real PNG ZIP download, no browser errors. Tests verify actual alpha pixels, preview/archive byte equality, distinct formats, full-gallery versus main-only selection, approval failures and a 70-family collection without pagination. No paid provider requests were used. Existing client bundle-size warning remains.

## Follow-up edge-case audit

Manual Update preview now bypasses the collection cache. A changed source or failed refresh invalidates the visible approval state; failed previews have an explicit retry message and cannot be bulk-approved from stale cached content. Automatic per-image refresh still reuses unchanged previews. Applying an individual canvas to selected main images now preserves saved settings for unselected rugs.

Additional regressions cover changed-source reapproval, refresh failure/recovery, unselected draft preservation, partial approval errors and a rotation during an in-flight approval. Full suite: 360 tests / 62 files; production build passes.
