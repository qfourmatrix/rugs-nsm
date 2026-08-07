#!/usr/bin/env python3
"""Assemble every practically usable Runner room selected by parallel review."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


REQUIRED_SECTIONS = [
    "ROOM TYPE:",
    "FLOOR:",
    "WALLS:",
    "WINDOWS AND NATURAL LIGHT:",
    "ARTIFICIAL LIGHTING:",
    "CEILING:",
    "ANCHOR FURNITURE:",
    "SECONDARY FURNITURE:",
    "PROPS AND OBJECTS:",
    "RUG PLACEMENT ZONE:",
    "CAMERA POSITION:",
    "COMPOSITION:",
    "OVERALL SCENE DENSITY:",
    "MATERIAL REALISM NOTES:",
    "BEST RUG TYPES:",
    "NEGATIVE CONSTRAINTS:",
    "FINAL REUSABLE ROOM PROMPT:",
    "CAMERA_SIDE:",
]

REQUIRED_TOKENS = [
    "[RUG_REFERENCE]",
    "[RUG_SIZE]",
    "[RUG_COLOR_FAMILY]",
    "[SHOT_ASPECT_RATIO]",
    "[SHOT_TYPE]",
]

ARCHETYPES = {
    "long_hallway_gallery",
    "entry_foyer_lane",
    "open_living_circulation",
    "bedside_passage",
    "kitchen_galley_transition",
    "stair_landing_corridor",
}

ARCHETYPE_ALIASES = {
    "entry/foyer lane": "entry_foyer_lane",
    "long hallway/gallery": "long_hallway_gallery",
    "stair foyer circulation lane": "stair_landing_corridor",
    "galley_transition": "kitchen_galley_transition",
    "glass_gallery_corridor": "long_hallway_gallery",
    "stair_side_passage": "stair_landing_corridor",
}


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def load_selection(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return []
    if text.startswith("["):
        value = json.loads(text)
        if not isinstance(value, list):
            raise SystemExit(f"Selection must be a JSON array or JSONL: {path}")
        return value
    return [json.loads(line) for line in text.splitlines() if line.strip()]


def portable_relative(path: Path, base: Path) -> str:
    return os.path.relpath(path, start=base.parent).replace("\\", "/")


def stable_id(source_set: str, stem: str) -> str:
    room = "foyer" if source_set == "Foyer" else "hallway"
    return f"runner-{room}-{stem[:12]}"


def validate_prompt(path: Path) -> str:
    text = path.read_text(encoding="utf-8")
    missing_sections = [section for section in REQUIRED_SECTIONS if section not in text]
    if missing_sections:
        raise SystemExit(f"Prompt {path} is missing sections: {', '.join(missing_sections)}")
    positions = [text.index(section) for section in REQUIRED_SECTIONS]
    if positions != sorted(positions):
        raise SystemExit(f"Prompt sections are out of order: {path}")
    missing_tokens = [token for token in REQUIRED_TOKENS if token not in text]
    if missing_tokens:
        raise SystemExit(f"Prompt {path} is missing tokens: {', '.join(missing_tokens)}")
    return text


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selection-root", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--library-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--acquisition-manifest", type=Path, required=True)
    parser.add_argument("--screening-manifest", type=Path, required=True)
    parser.add_argument("--base-manifest", type=Path, required=True)
    parser.add_argument("--merged-manifest", type=Path, required=True)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    inventory_rows = load_jsonl(args.inventory)
    inventory = {(row["sourceSet"], row["sourceIndex"]): row for row in inventory_rows}
    selection_files = sorted(args.selection_root.rglob("selection.jsonl"))
    if not selection_files:
        raise SystemExit(f"No selection.jsonl files found under {args.selection_root}")

    candidates: list[tuple[dict, Path]] = []
    for selection_file in selection_files:
        for candidate in load_selection(selection_file):
            candidates.append((candidate, selection_file.parent))

    selected_by_key: dict[tuple[str, int], tuple[dict, Path]] = {}
    selected_sha: dict[str, tuple[str, int]] = {}
    for candidate, selection_dir in candidates:
        source_set = candidate.get("sourceSet")
        source_index = candidate.get("sourceIndex")
        key = (source_set, source_index)
        if key in selected_by_key:
            raise SystemExit(f"Duplicate selected source: {key}")
        source = inventory.get(key)
        if not source:
            raise SystemExit(f"Selection missing from inventory: {key}")
        if source["decodeStatus"] != "ok":
            raise SystemExit(f"Selected source cannot be decoded: {source['path']}")
        prior_key = selected_sha.get(source["sha256"])
        if prior_key:
            raise SystemExit(f"Duplicate selected source bytes: {key} and {prior_key}")
        selected_sha[source["sha256"]] = key
        selected_by_key[key] = (candidate, selection_dir)

    removed_by_key: dict[tuple[str, int], dict] = {}
    for removal_file in sorted(args.selection_root.rglob("cross-qa.jsonl")):
        for removal in load_selection(removal_file):
            key = (removal.get("sourceSet"), removal.get("sourceIndex"))
            if key in removed_by_key:
                raise SystemExit(f"Duplicate cross-QA removal: {key}")
            removed_by_key[key] = removal
    for key in removed_by_key:
        selected_by_key.pop(key, None)

    app_entries: list[dict] = []
    acquisition_entries: list[dict] = []
    copy_plan: list[tuple[Path, Path]] = []
    seen_ids: set[str] = set()
    seen_prompt_hashes: dict[str, Path] = {}

    for key in sorted(selected_by_key):
        candidate, selection_dir = selected_by_key[key]
        source = inventory[key]
        source_path = Path(source["path"])
        source_set = source["sourceSet"]
        expected_type = "runner_foyer" if source_set == "Foyer" else "runner_hallway"
        room_dir_name = "Runner Foyer" if source_set == "Foyer" else "Runner Hallway"
        room_root = args.library_root / room_dir_name
        preview_path = room_root / "KEEP" / source_path.name
        prompt_path = room_root / "reverse_engineered_KEEP" / f"{source_path.stem}.txt"
        draft_path = selection_dir / "prompt-drafts" / f"{source_path.stem}.txt"
        if not draft_path.is_file():
            raise SystemExit(f"Missing prompt draft for {source_path.name}: {draft_path}")
        prompt_text = validate_prompt(draft_path)
        prompt_hash = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()
        prior_prompt_path = seen_prompt_hashes.get(prompt_hash)
        if prior_prompt_path:
            raise SystemExit(f"Prompts must be image-specific; exact duplicate: {prior_prompt_path} and {draft_path}")
        seen_prompt_hashes[prompt_hash] = draft_path

        background_id = candidate.get("id") or stable_id(source_set, source_path.stem)
        if background_id in seen_ids:
            raise SystemExit(f"Duplicate background id: {background_id}")
        seen_ids.add(background_id)
        if candidate.get("type", expected_type) != expected_type:
            raise SystemExit(f"Wrong type for {source_path}: expected {expected_type}")
        raw_archetype = candidate.get("runnerArchetype")
        archetype = ARCHETYPE_ALIASES.get(raw_archetype, raw_archetype)
        if archetype not in ARCHETYPES:
            raise SystemExit(f"Unsupported or missing archetype for {source_path}: {archetype}")
        title = str(candidate.get("title") or f"Runner {room_dir_name} {source_path.stem[:8]}").strip()
        if not title:
            raise SystemExit(f"Empty title for {source_path}")

        copy_plan.extend([(source_path, preview_path), (draft_path, prompt_path)])
        app_entries.append({
            "id": background_id,
            "type": expected_type,
            "title": title,
            "promptPath": portable_relative(prompt_path, args.manifest),
            "previewImagePath": portable_relative(preview_path, args.manifest),
            "runnerArchetype": archetype,
        })
        acquisition_entries.append({
            **candidate,
            "id": background_id,
            "type": expected_type,
            "runnerArchetype": archetype,
            "sourcePath": str(source_path),
            "sourceSha256": source["sha256"],
            "sourceDimensions": {"width": source["width"], "height": source["height"]},
            "orientation": source["orientation"],
            "license": "user_attested_authorized_for_app_and_friend_copy_2026-08-05",
            "redistributionAllowed": True,
            "previewImagePath": str(preview_path),
            "promptPath": str(prompt_path),
            "rejectionReason": None,
        })

    base_entries = load_jsonl(args.base_manifest)
    base_ids = {entry.get("id") for entry in base_entries}
    duplicate_base_ids = sorted(base_ids & seen_ids)
    if duplicate_base_ids:
        raise SystemExit(f"Expanded ids collide with base manifest: {', '.join(duplicate_base_ids)}")

    screening_entries: list[dict] = []
    for source in inventory_rows:
        selected_pair = selected_by_key.get((source["sourceSet"], source["sourceIndex"]))
        if selected_pair:
            candidate = selected_pair[0]
            final_status = "keep"
            rejection_reasons: list[str] = []
        elif (source["sourceSet"], source["sourceIndex"]) in removed_by_key:
            candidate = None
            final_status = "cross_qa_reject"
            rejection_reasons = [str(removed_by_key[(source["sourceSet"], source["sourceIndex"])].get("reason") or "cross_qa_reject")]
        elif source["automaticStatus"] == "reject":
            candidate = None
            final_status = "automatic_reject"
            rejection_reasons = source["automaticRejectionReasons"]
        else:
            candidate = None
            final_status = "manual_reject"
            rejection_reasons = ["did_not_pass_practical_runner_lane_review"]
        screening_entries.append({
            "sourceSet": source["sourceSet"],
            "sourceIndex": source["sourceIndex"],
            "sourcePath": source["path"],
            "sourceSha256": source["sha256"],
            "dimensions": {"width": source["width"], "height": source["height"]},
            "orientation": source["orientation"],
            "decodeStatus": source["decodeStatus"],
            "finalStatus": final_status,
            "rejectionReasons": rejection_reasons,
            "selectedId": (candidate.get("id") or stable_id(source["sourceSet"], Path(source["path"]).stem)) if candidate else None,
            "runnerArchetype": ARCHETYPE_ALIASES.get(candidate.get("runnerArchetype"), candidate.get("runnerArchetype")) if candidate else None,
            "qualityScore": candidate.get("qualityScore") if candidate else None,
            "license": "user_attested_authorized_for_app_and_friend_copy_2026-08-05",
            "redistributionAllowed": True,
        })

    print(json.dumps({
        "selectionFiles": [str(path) for path in selection_files],
        "crossQaRemovals": len(removed_by_key),
        "selected": len(app_entries),
        "foyer": sum(entry["type"] == "runner_foyer" for entry in app_entries),
        "hallway": sum(entry["type"] == "runner_hallway" for entry in app_entries),
        "merged": len(base_entries) + len(app_entries),
        "copyOperations": len(copy_plan),
        "dryRun": args.dry_run,
    }, indent=2))
    if args.dry_run:
        return

    for source_path, destination_path in copy_plan:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)

    outputs = [
        (args.manifest, app_entries),
        (args.acquisition_manifest, acquisition_entries),
        (args.screening_manifest, screening_entries),
        (args.merged_manifest, [*base_entries, *app_entries]),
    ]
    for output_path, rows in outputs:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(
            "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
