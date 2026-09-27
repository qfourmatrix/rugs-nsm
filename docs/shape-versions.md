# Runner and Round workspace versions

Open an existing Runner or Round, then choose **New version**. Its base workshop starts from the family’s Area image. Generate and approve a new base, then **Open approved product** to use the usual shot-generation, refinement, gallery and export workflow. New version does not itself make a provider call.

The **Version** dropdown switches between approved workspaces and reopens a version whose base is still in progress. Each approved version has a distinct product directory, so bases, product settings, shots, gallery selections, manual image backups and source-bound cutouts remain independent. Earlier directories are never overwritten. Candidate records carry the version through generation and approval; generating another candidate retains earlier candidates for the same Area source.

**Use for export** persistently selects one approved version per family/shape. Creating or approving V2 does not replace V1’s export choice. Gallery export filters to the chosen version and shows its version number. Changing export version does not approve its images or gallery. Family navigation stays grouped without duplicate family cards.

Legacy shapes are V1 and keep their existing paths and records. V2 and later use `family--runner--v2` / `family--round--v2`, with optional version metadata; the Area remains the family source. The selection map is private catalog metadata in `.product-shot-queue/shape-export-versions.json`.

Validation uses synthetic local mock images, never paid provider calls. File-backed tests cover separate V1/V2 materialization, exact preservation of V1 and Area files, version metadata validation, idempotent approval and persisted export choice. Real browser coverage exercises New version, generation, closing/reopening the unfinished version, approval, version switching and explicit export selection.
