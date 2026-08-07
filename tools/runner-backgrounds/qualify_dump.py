#!/usr/bin/env python3
"""Inventory Runner room-image dumps and build review contact sheets without mutating sources."""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps, UnidentifiedImageError


SUPPORTED_EXTENSIONS = {".jpg", ".jpeg", ".png", ".webp", ".gif"}
TILE_WIDTH = 224
TILE_HEIGHT = 168
LABEL_HEIGHT = 30
COLUMNS = 6
ROWS = 6
PAGE_SIZE = COLUMNS * ROWS


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def difference_hash(image: Image.Image) -> str:
    gray = ImageOps.grayscale(image).resize((9, 8), Image.Resampling.LANCZOS)
    pixels = list(gray.getdata())
    value = 0
    for row in range(8):
        for column in range(8):
            value = (value << 1) | int(pixels[row * 9 + column] > pixels[row * 9 + column + 1])
    return f"{value:016x}"


def orientation(width: int, height: int) -> str:
    ratio = width / height
    if ratio > 1.1:
        return "landscape"
    if ratio < 0.9:
        return "portrait"
    return "square"


def inventory(source_name: str, source_dir: Path) -> list[dict]:
    records: list[dict] = []
    paths = sorted(
        path for path in source_dir.rglob("*")
        if path.is_file() and path.suffix.lower() in SUPPORTED_EXTENSIONS
    )
    for position, path in enumerate(paths, start=1):
        record = {
            "sourceSet": source_name,
            "sourceIndex": position,
            "file": path.name,
            "path": str(path),
            "extension": path.suffix.lower(),
            "sizeBytes": path.stat().st_size,
            "sha256": sha256_file(path),
            "decodeStatus": "ok",
            "width": None,
            "height": None,
            "orientation": None,
            "frameCount": None,
            "differenceHash": None,
            "automaticStatus": "review",
            "automaticRejectionReasons": [],
            "duplicateOf": None,
        }
        try:
            with Image.open(path) as raw:
                record["frameCount"] = getattr(raw, "n_frames", 1)
                raw.seek(0)
                image = ImageOps.exif_transpose(raw).convert("RGB")
                width, height = image.size
                record.update({
                    "width": width,
                    "height": height,
                    "orientation": orientation(width, height),
                    "differenceHash": difference_hash(image),
                })
                if min(width, height) < 900:
                    record["automaticRejectionReasons"].append("short_edge_below_900px")
                if max(width, height) < 1400:
                    record["automaticRejectionReasons"].append("long_edge_below_1400px")
                if record["frameCount"] != 1:
                    record["automaticRejectionReasons"].append("animated_or_multiframe")
        except (OSError, UnidentifiedImageError, ValueError) as error:
            record["decodeStatus"] = "error"
            record["automaticRejectionReasons"].append("decode_error")
            record["decodeError"] = str(error)
        if record["automaticRejectionReasons"]:
            record["automaticStatus"] = "reject"
        records.append(record)
    return records


def mark_duplicates(records: list[dict]) -> None:
    exact_seen: dict[str, str] = {}
    visual_seen: dict[str, str] = {}
    for record in records:
        canonical = exact_seen.get(record["sha256"])
        if canonical:
            record["automaticStatus"] = "reject"
            record["automaticRejectionReasons"].append("exact_duplicate")
            record["duplicateOf"] = canonical
            continue
        exact_seen[record["sha256"]] = record["path"]
        visual_hash = record.get("differenceHash")
        if not visual_hash:
            continue
        canonical = visual_seen.get(visual_hash)
        if canonical:
            record["automaticStatus"] = "reject"
            record["automaticRejectionReasons"].append("visual_duplicate_same_dhash")
            record["duplicateOf"] = canonical
            continue
        visual_seen[visual_hash] = record["path"]


def contain_thumbnail(image: Image.Image, width: int, height: int) -> Image.Image:
    contained = ImageOps.contain(image, (width, height), Image.Resampling.LANCZOS)
    tile = Image.new("RGB", (width, height), (34, 34, 34))
    tile.paste(contained, ((width - contained.width) // 2, (height - contained.height) // 2))
    return tile


def build_contact_sheets(records: list[dict], output_dir: Path, source_name: str) -> list[Path]:
    review_records = [record for record in records if record["automaticStatus"] == "review"]
    sheets_dir = output_dir / "contact-sheets" / source_name.lower()
    sheets_dir.mkdir(parents=True, exist_ok=True)
    sheet_paths: list[Path] = []
    font = ImageFont.load_default(size=13)
    for page_index in range(0, len(review_records), PAGE_SIZE):
        page_records = review_records[page_index: page_index + PAGE_SIZE]
        canvas = Image.new(
            "RGB",
            (COLUMNS * TILE_WIDTH, ROWS * (TILE_HEIGHT + LABEL_HEIGHT)),
            (18, 18, 18),
        )
        draw = ImageDraw.Draw(canvas)
        for tile_index, record in enumerate(page_records):
            row, column = divmod(tile_index, COLUMNS)
            x = column * TILE_WIDTH
            y = row * (TILE_HEIGHT + LABEL_HEIGHT)
            try:
                with Image.open(record["path"]) as raw:
                    raw.seek(0)
                    image = ImageOps.exif_transpose(raw).convert("RGB")
                    canvas.paste(contain_thumbnail(image, TILE_WIDTH, TILE_HEIGHT), (x, y))
            except (OSError, UnidentifiedImageError, ValueError):
                draw.rectangle((x, y, x + TILE_WIDTH, y + TILE_HEIGHT), fill=(90, 15, 15))
            label = f"{record['sourceIndex']:04d} {Path(record['file']).stem[:12]}"
            draw.rectangle(
                (x, y + TILE_HEIGHT, x + TILE_WIDTH, y + TILE_HEIGHT + LABEL_HEIGHT),
                fill=(8, 8, 8),
            )
            draw.text((x + 5, y + TILE_HEIGHT + 7), label, fill=(240, 240, 240), font=font)
        page_number = page_index // PAGE_SIZE + 1
        sheet_path = sheets_dir / f"{source_name.lower()}-{page_number:03d}.jpg"
        canvas.save(sheet_path, "JPEG", quality=90, optimize=True)
        sheet_paths.append(sheet_path)
    return sheet_paths


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--foyer", type=Path, required=True)
    parser.add_argument("--hallway", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()

    args.output.mkdir(parents=True, exist_ok=True)
    records = inventory("Foyer", args.foyer) + inventory("Hallway", args.hallway)
    mark_duplicates(records)

    inventory_path = args.output / "inventory.jsonl"
    with inventory_path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")

    summaries = {}
    for source_name in ("Foyer", "Hallway"):
        source_records = [record for record in records if record["sourceSet"] == source_name]
        sheets = build_contact_sheets(source_records, args.output, source_name)
        summaries[source_name] = {
            "total": len(source_records),
            "automaticReview": sum(record["automaticStatus"] == "review" for record in source_records),
            "automaticReject": sum(record["automaticStatus"] == "reject" for record in source_records),
            "contactSheets": [str(path) for path in sheets],
        }

    (args.output / "summary.json").write_text(
        json.dumps({"schemaVersion": 1, "sources": summaries}, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summaries, indent=2))


if __name__ == "__main__":
    main()
