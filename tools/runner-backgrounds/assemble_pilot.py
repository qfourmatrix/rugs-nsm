#!/usr/bin/env python3
"""Assemble the reviewed Runner pilot without changing either source dump."""

from __future__ import annotations

import argparse
import json
import os
import shutil
from pathlib import Path


def load_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def portable_relative(path: Path, base: Path) -> str:
    return os.path.relpath(path, start=base.parent).replace("\\", "/")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--selection", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--drafts", type=Path, required=True)
    parser.add_argument("--library-root", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--acquisition-manifest", type=Path, required=True)
    parser.add_argument("--screening-manifest", type=Path, required=True)
    parser.add_argument("--base-manifest", type=Path)
    parser.add_argument("--merged-manifest", type=Path)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    selection = json.loads(args.selection.read_text(encoding="utf-8"))
    provenance = selection["provenance"]
    inventory = {
        (record["sourceSet"], record["sourceIndex"]): record
        for record in load_jsonl(args.inventory)
    }
    app_entries: list[dict] = []
    acquisition_entries: list[dict] = []
    copy_plan: list[tuple[Path, Path]] = []

    for candidate in selection["candidates"]:
        key = (candidate["sourceSet"], candidate["sourceIndex"])
        source = inventory.get(key)
        if not source:
            raise SystemExit(f"Selection is missing from inventory: {key}")
        if source["automaticStatus"] != "review":
            raise SystemExit(f"Selected source failed automatic gates: {source['path']}")

        source_path = Path(source["path"])
        room_dir_name = "Runner Foyer" if candidate["sourceSet"] == "Foyer" else "Runner Hallway"
        room_root = args.library_root / room_dir_name
        preview_path = room_root / "KEEP" / source_path.name
        prompt_path = room_root / "reverse_engineered_KEEP" / f"{source_path.stem}.txt"

        draft_matches = list(args.drafts.rglob(f"{source_path.stem}.txt"))
        if len(draft_matches) != 1:
            raise SystemExit(
                f"Expected exactly one prompt draft for {source_path.name}; found {len(draft_matches)}"
            )
        draft_path = draft_matches[0]
        prompt = draft_path.read_text(encoding="utf-8")
        required_sections = [
            "ROOM TYPE:",
            "RUG PLACEMENT ZONE:",
            "CAMERA POSITION:",
            "NEGATIVE CONSTRAINTS:",
            "FINAL REUSABLE ROOM PROMPT:",
            "CAMERA_SIDE:",
        ]
        missing_sections = [section for section in required_sections if section not in prompt]
        if missing_sections:
            raise SystemExit(f"Prompt {draft_path} is missing: {', '.join(missing_sections)}")
        required_tokens = [
            "[RUG_REFERENCE]",
            "[RUG_SIZE]",
            "[RUG_COLOR_FAMILY]",
            "[SHOT_ASPECT_RATIO]",
            "[SHOT_TYPE]",
        ]
        missing_tokens = [token for token in required_tokens if token not in prompt]
        if missing_tokens:
            raise SystemExit(f"Prompt {draft_path} is missing tokens: {', '.join(missing_tokens)}")

        copy_plan.extend([(source_path, preview_path), (draft_path, prompt_path)])
        app_entries.append({
            "id": candidate["id"],
            "type": candidate["type"],
            "title": candidate["title"],
            "promptPath": portable_relative(prompt_path, args.manifest),
            "previewImagePath": portable_relative(preview_path, args.manifest),
            "runnerArchetype": candidate["runnerArchetype"],
        })
        acquisition_entries.append({
            **candidate,
            "sourcePath": str(source_path),
            "sourceSha256": source["sha256"],
            "sourceDimensions": {"width": source["width"], "height": source["height"]},
            "orientation": source["orientation"],
            "sourceUrl": None,
            "license": provenance["license"],
            "redistributionAllowed": provenance["redistributionAllowed"],
            "previewImagePath": str(preview_path),
            "promptPath": str(prompt_path),
            "rejectionReason": None,
        })

    print(json.dumps({
        "selected": len(app_entries),
        "runnerRoomBackgrounds": len(app_entries),
        "availableToBothRoomShots": len(app_entries),
        "copyOperations": len(copy_plan),
        "dryRun": args.dry_run,
    }, indent=2))
    if args.dry_run:
        return

    for source_path, destination_path in copy_plan:
        destination_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source_path, destination_path)
    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in app_entries),
        encoding="utf-8",
    )
    args.acquisition_manifest.parent.mkdir(parents=True, exist_ok=True)
    args.acquisition_manifest.write_text(
        "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in acquisition_entries),
        encoding="utf-8",
    )
    selected_by_source = {
        (entry["sourceSet"], entry["sourceIndex"]): entry
        for entry in acquisition_entries
    }
    conditional_rejects = {
        (entry["sourceSet"], entry["sourceIndex"]): entry
        for entry in selection.get("conditionalRejects", [])
    }
    screening_entries: list[dict] = []
    for source in inventory.values():
        selected = selected_by_source.get((source["sourceSet"], source["sourceIndex"]))
        conditional_reject = conditional_rejects.get((source["sourceSet"], source["sourceIndex"]))
        if selected:
            final_status = "keep"
            rejection_reasons: list[str] = []
        elif conditional_reject:
            final_status = "conditional_reject"
            rejection_reasons = [conditional_reject["rejectionReason"]]
        elif source["automaticStatus"] == "reject":
            final_status = "automatic_reject"
            rejection_reasons = source["automaticRejectionReasons"]
        else:
            final_status = "manual_not_shortlisted"
            rejection_reasons = ["did_not_rank_into_strict_pilot_after_contact_sheet_review"]
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
            "selectedId": selected["id"] if selected else None,
            "runnerArchetype": selected["runnerArchetype"] if selected else None,
            "runnerShotCompatibility": selected["runnerShotCompatibility"] if selected else [],
            "qualityScore": selected["qualityScore"] if selected else None,
            "license": provenance["license"],
            "redistributionAllowed": provenance["redistributionAllowed"],
        })
    args.screening_manifest.parent.mkdir(parents=True, exist_ok=True)
    args.screening_manifest.write_text(
        "".join(json.dumps(entry, ensure_ascii=False) + "\n" for entry in screening_entries),
        encoding="utf-8",
    )
    if bool(args.base_manifest) != bool(args.merged_manifest):
        raise SystemExit("--base-manifest and --merged-manifest must be provided together")
    if args.base_manifest and args.merged_manifest:
        base_entries = load_jsonl(args.base_manifest)
        base_ids = {entry.get("id") for entry in base_entries}
        pilot_ids = {entry["id"] for entry in app_entries}
        duplicate_ids = sorted(base_ids & pilot_ids)
        if duplicate_ids:
            raise SystemExit(f"Pilot ids already exist in base manifest: {', '.join(duplicate_ids)}")
        args.merged_manifest.parent.mkdir(parents=True, exist_ok=True)
        args.merged_manifest.write_text(
            "".join(
                json.dumps(entry, ensure_ascii=False) + "\n"
                for entry in [*base_entries, *app_entries]
            ),
            encoding="utf-8",
        )


if __name__ == "__main__":
    main()
