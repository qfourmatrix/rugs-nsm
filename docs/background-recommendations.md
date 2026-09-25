# Curated background recommendations

Choose Background now includes a Recommended filter. It shows a product's curated rooms in saved rank order, with a short reason and the existing New/Used label. Selecting a recommendation uses the existing background selection and persistence flow. All, search and the other filters remain available. Shuffle operates on All and never changes the saved recommendation order.

Recommendations are prepared outside the app by visually reviewing the source rug, relevant accepted output history and active room library. They can include previously unused rooms. This feature does not run agents, spend generation credits, learn automatically, or create recommendations for new products at runtime. A product without a saved list shows an empty state and a Browse all backgrounds action.

## Private catalog pack

The app reads `CATALOG/.product-shot-queue/background-recommendations.json`. Keep customer catalogs, taste histories, room assets and curated packs outside the public code repository.

The version-1 schema lives in `app/shared/background-recommendations.ts`. Each entry contains a product ID, shape, source base filename/byte size/integer modification time, and an ordered list of background IDs with reasons. The source metadata is a portable change detector, not a cryptographic image fingerprint. A replacement that preserves all three source attributes cannot be detected by this mechanism.

A changed or invalid base suppresses the entire product's list. Removed backgrounds and incompatible shapes are omitted, preserving the remaining original rank numbers. Runner room shots only use Foyer/Hallway; Area/Round exclude these types. Studio shots show an explanation instead of room recommendations. Missing or malformed packs do not prevent browsing All. Pack replacements are picked up on reopening the picker; no restart is needed for a data-only import.

Room JPEGs remain preview references. This feature does not change prompt construction, room text injection, generation inputs or shot profiles.

## Import

After updating the app code, run from the app directory with its configured Node runtime on PATH:

```sh
./node_modules/.bin/tsx scripts/import-background-recommendations.ts /path/to/catalog /path/to/pack.json
./node_modules/.bin/tsx scripts/import-background-recommendations.ts /path/to/catalog /path/to/pack.json --apply
```

The first command previews the import without writing. The second merges entries for matching source rugs, skips missing/changed/invalid rugs, preserves unrelated recommendations, backs up an existing pack, and atomically replaces the pack. An exclusive import lock prevents simultaneous importers. Repeating the same import is a no-op. Catalog approval/gallery state is not rewritten. Active background compatibility is checked when the app serves the recommendations.

If an import is interrupted and reports an existing lock, first verify that no importer is running; only then remove `.product-shot-queue/.background-recommendations-import.lock`. A malformed existing pack is never overwritten automatically. To roll back, restore the reported backup to the original pack path, then reopen the picker. Keep the backup until the imported choices have been checked.

## Verification

The scoped tests cover product/source isolation, rank preservation, invalid packs, retired or incompatible rooms, cache invalidation, import preview/backup/merge/idempotency, late response cancellation, retry, existing pagination and selection, and keyboard close/focus restoration. Browser validation should use a disposable catalog in mock provider mode and exercise Area, Runner, Round, reload persistence, search, stale source fallback, and desktop/mobile layout. No paid generation is needed to test this feature.
