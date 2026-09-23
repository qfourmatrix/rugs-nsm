# Performance update: history recovery and rollback

Local implementation notes. This is not approval to update or downgrade a friend's installation.

## What changed

Job history and generation-request admission now use `.product-shot-queue/job-ledger.sqlite` under the configured product root. The bundled Node runtime used in validation is Node24.18.0 ARM64. Use the bundled runtime rather than an arbitrary system Node installation. The database uses SQLite WAL and FULL synchronous writes; keep it on a local filesystem, not a concurrently synchronized/network-mounted live database.

First startup imports the existing `jobs.json` transactionally, leaves it untouched, and retains `jobs.pre-ledger-v1.json`. Import happens once. The legacy files do **not** contain jobs created after migration. Do not delete the ledger to force a reimport.

## Before any downgrade

1. Finish/cancel active jobs and inspect any unknown provider outcomes. Do not resubmit uncertain paid requests. A legacy app cannot enforce the new ledger's request protection.
2. Stop every studio server using this product root. Close its browser tabs. Do not run old and new servers against the same catalog.
3. Preserve the entire `.product-shot-queue` directory, including any SQLite WAL/SHM files, with the server stopped. Preserve product/generated/trash files too using the normal backup process. Never copy only the main SQLite file from a running WAL database.
4. Create a separate compatibility history snapshot with the new code **before** switching versions. From `app/`, run the bundled Node with `node_modules/tsx/dist/cli.mjs scripts/export-job-history.ts`, followed by the absolute product root and an absolute **new** output filename. Example arguments must be replaced with the actual configured paths; this document intentionally does not assume the deployment's catalog location.
5. Verify the printed count/SHA256 and keep that snapshot separately. The command opens the ledger read-only, streams all records newest-first, refuses active jobs/unknown started dispatches, and atomically publishes a new file without overwriting anything. It does not stop servers, install a backup, alter images or migrate a deployment.
6. Only after checking the target older version's `jobs.json` schema should an operator install the snapshot as that version's legacy history, preserving the previous file separately. Do not downgrade blindly: other state/schema changes may also require compatibility checks.

The JSON snapshot preserves job records, not generation-request keys, frozen dispatch payloads or all application state. The complete state-directory backup remains essential. Never automatically replay requests after downgrade.

## Returning to the new version

Restore the matching stopped-app backup as a whole. Do not mix an older database with newer state files. If work occurred under the legacy version, reconcile its new jobs and files explicitly before returning: the already-imported ledger intentionally will not silently import `jobs.json` a second time.

A read-only snapshot can also aid diagnosis without committing to rollback. A successful snapshot is not proof that a particular older release is compatible.
