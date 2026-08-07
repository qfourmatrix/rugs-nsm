# Runner Background Library PRD

Status: expanded local implementation
Scope: Foyer and Hallway rooms for `Runner · Wide Room Hero` and `Runner · High-Angle Lifestyle Detail` only
Out of scope: Studio Corner Detail, Texture Macro, and Folded Label Detail; these retain controlled pure-white studio instructions.

## Outcome

Build a local, prompt-backed library of rooms that can physically accept one approved long, narrow Runner. The selected JPEG is a picker preview only and is not attached to the provider request. Its matching TXT room prompt supplies secondary architecture, floor, furniture, lighting, and camera context, while the approved rug remains the only attached image and sole product-identity reference in Image 1. The mandatory shape-specific Runner shot profile has final authority over the camera treatment.

The supplied source dumps contain 1,227 Foyer images and 1,830 Hallway images. After technical screening, visual lane review, prompt validation, and duplicate cross-QA, the expanded active set contains 577 rooms: 194 Foyers and 383 Hallways. The merged app library contains these 577 Runner rooms plus all 897 legacy Area/Round rooms, for 1,474 backgrounds total.

## Observed market and product evidence

Current official merchandising treats runners as products for narrow, high-traffic circulation spaces rather than compressed Area rugs. Ruggable currently lists standard 2.5 × 7 ft and 2.5 × 10 ft Runner formats and names hallways, entryways, and kitchens as primary placements. Revival describes the Runner as a visual pathway and recommends an exposed floor border rather than wall-to-wall placement. These facts support the library’s long-lane, exposed-margin, and full-silhouette gates.

- [Ruggable Runner collection and current sizes](https://ruggable.com/en-CA/collections/runner-rugs)
- [Ruggable 2 × 10 ft Runner use cases](https://ruggable.com/collections/10-ft-runner-rugs)
- [Revival hallway Runner collection](https://www.revivalrugs.com/pages/shop-runner-rugs-for-hallways)
- [Revival extra-long hallway Runner guidance](https://www.revivalrugs.com/EN-US/pages/shop-extra-long-hallway-runner-rugs)
- [Revival entryway Runner collection](https://www.revivalrugs.com/pages/shop-runner-rugs-for-entryway)

Competitor imagery is research evidence only. It must not be copied into the distributable app unless an explicit license permits redistribution.

## Shot taxonomy

### Runner · Wide Room Hero

Purpose: establish the complete Runner naturally in a premium room while making the manufactured long-format body immediately readable.

Room contract:

- Use a real circulation lane with one coherent, elongated floor plane.
- Preserve the selected room’s architecture, materials, furniture language, light direction, and practical-light state.
- Keep furniture and floor objects outside the Runner footprint.
- Leave a narrow, believable exposed-floor border along both long sides and both short ends.
- The room must permit reframing to a waist-to-chest-height camera, a controlled 30–45° downward view, and a natural 35–50 mm full-frame lens feel.
- Camera must be across one long side or at a mild three-quarter angle. The source preview may be axial, but the final reusable prompt must not request a directly end-on Runner view.
- Both short ends and both long edges must remain visible and useful for judging ratio, borders, edge finish, and fringe topology.
- Reject wall-to-wall placement, hard long-axis foreshortening, furniture overlap, hidden ends, bent paths, and a square/Area-rug reading.

### Runner · High-Angle Lifestyle Detail

Purpose: prove complete long-format geometry, design rhythm, and edge continuity from a naturally elevated lifestyle view.

Room contract:

- Require a genuinely elevated camera position and a complete single-plane elongated floor polygon.
- The room must permit a 60–75° downward three-quarter view with a natural 45–70 mm full-frame lens feel.
- Center the camera near the Runner midpoint and rotate the composition; do not shoot down the long axis from an end.
- Show both ends, both long edges, and all fringe or binding with narrow floor margins.
- Reject eye-level rooms mislabeled as high-angle, staircase-only views, stairwell voids that split the lane, irregular landings, and any floor plane too small for the complete Runner.

## Validated archetypes

| Archetype | Wide Hero | High-Angle | Physical requirement |
|---|---:|---:|---|
| Long hallway / gallery | Yes | Conditional | Straight or gently oblique single floor plane; no turn inside the Runner footprint |
| Entry / foyer lane | Yes | Conditional | Long threshold-to-interior lane with door-swing and threshold clearance |
| Open living circulation path | Future | Conditional | Furniture remains outside a complete rectangular Runner zone |
| Bedside passage | Future | Conditional | Bed and nightstands do not tuck under or crop the Runner |
| Kitchen / galley transition | Future | Conditional | No island, stools, or cabinet door crosses the lane |
| Stair landing / corridor | Conditional | Yes | Full elongated landing plane with no stairwell void or tread placement |

The expanded set implements `entry_foyer_lane` (112), `long_hallway_gallery` (373), `stair_landing_corridor` (69), and `kitchen_galley_transition` (23). Open-living and bedside-passage remain valid future acquisition targets.

## Candidate scoring

Score every candidate from 0 to 100 after automatic technical gates:

| Dimension | Weight | Full-credit condition |
|---|---:|---|
| Floor polygon and scale | 30 | Complete elongated single-plane polygon with side/end margins and no obstructions |
| Shot-camera adaptability | 20 | Can satisfy the target shot camera without end-on compression or impossible wall removal |
| Perspective coherence | 15 | Stable vanishing direction, controlled verticals, believable scale |
| Product separation / negative space | 10 | Runner can dominate without competing furniture, décor, or patterned floor |
| Lighting and grounding | 10 | Coherent light direction and enough tonal detail for edge contact shadows |
| Resolution and image integrity | 10 | At least 900 px short edge and 1,400 px long edge; clean decode; no corruption |
| Styling and material realism | 5 | Premium, reconstructable materials without excessive visual noise |

Thresholds:

- 85–100: pilot keep.
- 75–84: reserve only after individual full-resolution review.
- Below 75: reject.
- A hard rejection always overrides score.

## Hard rejection criteria

Automatically or manually reject any candidate containing:

- A loose source rug, runner, or mat that obscures the placement polygon so the underlying floor and clearance cannot be reconstructed. If the floor geometry remains unambiguous, the reusable room prompt omits the loose textile while preserving permanent flooring.
- A person, pet, readable brand, logo, watermark, or prominent text.
- Furniture, plants, baskets, shoes, doors, or décor crossing the placement zone.
- A turn, curve, split level, threshold, stair tread, or stairwell void inside the proposed footprint.
- An incomplete or too-short floor polygon, or a lane whose far endpoint is blocked.
- Perspective so end-on that the Runner would read short, or a room too narrow to reframe to a mild three-quarter view.
- Severe blown highlights, crushed floor detail, motion blur, image corruption, or unrealistic render artifacts.
- Duplicate or near-duplicate imagery, failed decode, animation, short edge below 900 px, or long edge below 1,400 px.

## Reverse-engineering prompt contract

Every accepted preview has one same-basename UTF-8 `.txt` file with these sections:

1. `ROOM TYPE`
2. `FLOOR`
3. `WALLS`
4. `WINDOWS AND NATURAL LIGHT`
5. `ARTIFICIAL LIGHTING`
6. `CEILING`
7. `ANCHOR FURNITURE`
8. `SECONDARY FURNITURE`
9. `PROPS AND OBJECTS`
10. `RUG PLACEMENT ZONE`
11. `CAMERA POSITION`
12. `COMPOSITION`
13. `OVERALL SCENE DENSITY`
14. `MATERIAL REALISM NOTES`
15. `BEST RUG TYPES`
16. `NEGATIVE CONSTRAINTS`
17. `FINAL REUSABLE ROOM PROMPT`
18. `CAMERA_SIDE`

The descriptive sections record observed evidence. The final reusable prompt must contain `[RUG_REFERENCE]`, `[RUG_SIZE]`, `[RUG_COLOR_FAMILY]`, `[SHOT_ASPECT_RATIO]`, and `[SHOT_TYPE]`; preserve the exact Runner ratio, design, edges, and fringe topology; prohibit source-rug copying; and adapt the observed room camera to the mandatory target-shot profile when they conflict.

## Metadata and filtering contract

Each app manifest entry uses a simple Runner room type and may include a descriptive archetype:

```json
{
  "type": "runner_foyer",
  "runnerArchetype": "entry_foyer_lane"
}
```

Runner selection is intentionally type-based: both Runner room shots show backgrounds with type `runner_foyer` or `runner_hallway`. There is no second per-shot compatibility gate. Those Runner-only types are excluded from Area and Round selectors, so merging the add-on does not change their established room choices. The mandatory shape-shot profile remains responsible for the Wide versus High-Angle camera contract. At generation time, the matching TXT room prompt is injected as text-only secondary context; no room image is attached, and rug identity comes only from Image 1.

## Provenance policy

- Keep original source dumps unchanged.
- Record source path, SHA-256, dimensions, orientation, source URL when known, license, and redistribution status.
- User-supplied files with no provenance metadata are marked `unknown_user_attestation_required` and `redistributionAllowed: false`.
- Such images may be used as local picker previews only; do not publish, bundle, or send them outside the local project until the user confirms rights.
- On 2026-08-05, the user confirmed that both supplied dumps are authorized for app use and sharing with a friend's app copy. The campaign manifests therefore record `user_attested_authorized_for_app_and_friend_copy_2026-08-05` and `redistributionAllowed: true`.
- Do not scrape or silently redistribute competitor product photography.
- A reverse-engineered factual room description is stored separately from its preview image.

## Acceptance criteria

- All selected images pass decode, resolution, duplicate, and manual hard gates.
- Every selected image has exactly one matching prompt with all 18 sections and required tokens.
- Every manifest entry resolves to an existing preview and prompt.
- Both Runner room shots return only `runner_foyer` and `runner_hallway` items.
- Empty compatible sets are rendered safely and remain recoverable through library management.
- Stale selected IDs block generation instead of silently passing.
- Initial generation and retry paths reject incompatible Runner backgrounds.
- Runner-only records never appear in Area/Round selectors or retries; their legacy backgrounds continue to load and select normally.
- The merge-safe installer preserves the recipient's ordinary manifest records and local state, updates only Runner-owned records, and is idempotent.
- Focused metadata/filter tests, complete app tests, TypeScript, production build, and rendered browser smoke QA pass without paid image generation.

## Active shortlist

The original 17-room source-of-truth pilot remains documented in [`tools/runner-backgrounds/pilot-selection.json`](../tools/runner-backgrounds/pilot-selection.json). The active expanded source of truth is `data/nsm100k/runner-background-library-expanded.jsonl` in the local app data root.

- Wide Hero: all 577 type-compatible rooms are selectable.
- High-Angle: the same 577 rooms are selectable; the mandatory High-Angle shot profile controls the generated camera instead of a hidden per-background compatibility flag.
- Expanded acquisition manifest: `data/nsm100k/runner-background-acquisition-expanded.jsonl`.
- Full keep/reject ledger: `data/nsm100k/runner-background-screening-expanded.jsonl`.

## User-input checklist

- Foyer/Hallway app-use and friend-copy authorization: confirmed by the user on 2026-08-05.
- Optional: provide more genuinely elevated Foyer/Hallway references if closer native High-Angle previews are desired. They are no longer required for the current type-based selection flow.
- For public deployment or sale beyond the authorized friend copy, retain the original license/source records or obtain a broader written grant.
