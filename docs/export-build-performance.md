# Export ZIP performance — 2026-09-29

The old exporter processed one shape at a time and recompressed already compressed images with ZIP level 9. Generated-image conversion also encoded and decoded a full-resolution PNG intermediary.

Changes: two shapes in flight through the existing two-slot conversion scheduler; await both workers before propagating failure/cancellation; retain requested receipt ordering. Store image entries directly in the ZIP, retaining compressed JSON. Replace the no-main-settings PNG intermediary with decoded sRGB pixels; preserve the decode boundary to avoid JPEG/WebP shrink-on-load differences. Image quality, dimensions, main preparation, original hashes, approval checks and provider request deadlines are unchanged.

## Measurement

Local Node 24; eight distinct synthetic textured 2048×2048 RGB PNGs, 1024px maximum output, WebP quality75, lossless false. Real buildGalleryExport path including inspection, source snapshots, conversion, ZIP packing and archive hash. Cold conversion caches in separate old/new modules; identical inputs. Baseline gallery/pipeline source from commit95a1c7c. Synthetic data, no paid provider or live catalog.

| Run | Old build | New build | Speedup |
| --- | ---: | ---: | ---: |
| Old then new | 4.455s | 1.842s | 2.42× |
| New then old, no concurrent test suite | 4.231s | 1.723s | 2.46× |

In reversed run time through final conversion fell from2.654s to1.545s; packing/finalization remainder fell from1.577s to0.178s. ZIP approximately104.7MB in both. All eight optimized hashes matched old/new; extracted archive original/output SHA256 and ZIP CRCs checked. This is a small local benchmark, not a measured ETA for Nassim’s1200images. Stored images can yield a larger ZIP for unusually compressible source files. Two workers increase peak conversion memory relative to one but retain the existing scheduler bound. Room-viewer PNGs benefit from packing/concurrency; their main-image preparation remains unchanged.

Validation includes full test suite/build; parity test for oriented JPEG, transparent PNG/WebP and grayscale, PNG/WebP exports and lossless modes; multiple-shape receipt order, stored ZIP entries, original integrity and cancellation tests.
