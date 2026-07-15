# Progress

## 2026-07-07

- [x] Added a sticky Current Shot command bar with shot name, status, output summary, readiness text, and Generate Selected action.
- [x] Collapsed the full prompt behind a two-line preview with an Edit Prompt toggle.
- [x] Moved aspect, size, batch, and construction into one compact settings row.
- [x] Reworked construction as an inline dropdown with expandable injected-prompt details.
- [x] Reworked Background into a selection-first section and moved manifest/label setup into Manage Library.
- [x] Converted the Shots area from two-column cards to a compact row queue with requirement markers, status, and Load/Loaded action.
- [x] Added explicit Requirements rows for background, label workflow, and construction.
- [x] Added per-rug construction state with `selectedConstructionId`, defaulting older product states to infer-from-base.
- [x] Added five construction presets: flatweave, low pile, high pile, mixed high-low, and unknown/custom.
- [x] Injected selected construction overrides into generation prompts while leaving unset rugs on the global base-image realism lock.
- [x] Saved construction snapshots in generated asset metadata for traceability.
- [x] Updated retry-failed and exact-retry flows to reuse the saved construction snapshot from the original attempt.
- [x] Added construction metadata display on generated attempt cards.
- [x] Added schema/test coverage for older product-state compatibility and mixed high-low prompt constraints.
- [x] Confirmed `npm test` passes.
- [x] Confirmed `npm run build` passes.
- [x] Completed rendered browser QA for desktop, prompt expansion, Manage Library, background picker, shot loading, and narrow viewport overflow.
- [x] Tightened Shot 3 `studio_corner_detail` and Shot 4 `texture_macro` for clean white studio output.
- [x] Removed negative/control wording from Shot 3 and Shot 4 to reduce concept bleed in generated images.
- [x] Updated both shared shot constants and `data/nsm100k/master-shots.json` with positive-only matte white seamless paper, softbox, catalogue-product prompt language.
- [x] Checked Shot 3 and Shot 4 prompts for leak-prone terms including `no`, `not`, `negative`, `window`, `reflection`, `room`, `furniture`, `cinematic`, and `sunlight`.
- [x] Reconfirmed `npm test` passes after the Shot 3/4 prompt cleanup.
