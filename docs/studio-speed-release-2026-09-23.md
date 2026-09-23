# Studio speed and completion previews

Code-only update. Creative workspace experiments, private assets, room-library files and credentials are not included. Runner shot profiles remain unchanged from the September release.

Includes bounded metadata/thumbnail caches, targeted scans, compact paginated histories, smoother rug/shape/background navigation, action-scoped generation controls, revision-aware draft saving, durable generation admission/history and thumbnail-only completion notifications.

Before updating: let active generations finish, stop the studio with Control-C, and leave Syncthing closed for the live product folder. Run `3 Update RUGS NSM.command`, wait for Update complete, then run `2 Start RUGS NSM.command`.

First startup migrates legacy job history into a local SQLite ledger while retaining the original history. Keep the live catalog on local storage and do not concurrently synchronize the running database. See `studio-performance-rollback.md` before any downgrade; simply switching old code back can omit new history and request protection.

Release verification: clean locked npm installation, 289 tests across 51 files and production build. Normal UI workflow uses disposable mock data only. This is not an endurance certification or a measured speed guarantee on the recipient's laptop. Existing npm audit findings (4 moderate, 6 high) and the existing bundle-size warning remain outside this release.

Completion previews are session-local, limited to six, and only notify for other rug/shape results. They do not replace saved job history. Clicking a thumbnail opens its exact shot in Compare; dismissal never deletes an image.
