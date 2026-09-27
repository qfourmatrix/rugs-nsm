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

## Main-image repair

In **Image detail**, **Restore with lasso** opens a straight-edge polygon selector over the saved cutout. Click corners (or use arrows and Enter), optionally show the original, then choose **Restore area**. Only selected pixels return from the source main image. Each repair saves a new unapproved child cutout; **Undo last restore** selects its parent. This is local work and does not call an image provider.

**Make top-down** opens a separate generation tool with **Generate top-down**, **Retry**, **Accept**, and **Restore original**. Opening the tool does not submit a generation. Explicit generation uses the existing durable queue and shared provider capacity, with no new request deadline. Every retry uses the preserved original. Results remain candidates until accepted; acceptance or restoring the original invalidates old cutout selection/approval and requires preparation again. Originals and replaced versions remain in the private catalog metadata directory. Review motif geometry, colors and fringe before accepting: preservation instructions do not guarantee model fidelity.

Validation: 366 tests / 65 files and production build pass. File-backed tests verify polygon boundaries, untouched pixels outside the selection, repair idempotency, source changes, immutable original backup, exact-byte restoration, and utility-shot exclusion from galleries. A real HTTP test with a local mock provider verifies duplicate submission suppression, active-job replacement blocking, explicit acceptance, retries from the original and exact restore. Production-browser checks at desktop and mobile sizes verify restore/undo and mock generate/accept with no browser errors or horizontal overflow. No paid generation was performed; actual rug-generation quality remains to be reviewed by the user. Existing bundle-size warning remains.

## Retouch in another editor

Image detail includes **Download original**, **Replace image**, and **Restore original image**. Download returns the preserved original bytes. Choose a retouched PNG, JPEG or WebP, inspect its preview, then press **Use this image**. Single images up to 40 MB / 40 megapixels are accepted; invalid images and stale-source replacements are rejected. Active work for that rug must finish first.

The original and replaced versions are retained. Transparent uploads also become a saved, unapproved manual cutout, preserving alpha even when the original base filename is JPEG. Export preparation selects that cutout without calling Photoroom. Opaque uploads become the new base and may be exported after review or have their backgrounds removed separately. Replacement resets old approval and keeps the shape selected for review. Other gallery revisions retain existing deselection behavior.
